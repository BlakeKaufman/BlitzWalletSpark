import {
  createContext,
  useState,
  useContext,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import {
  claimSparkBitcoinL1Transaction,
  getSparkBalance,
  getSparkLightningPaymentStatus,
  getSparkTransactions,
  getUnusedSparkBitcoinL1Address,
  sparkWallet,
  useSparkPaymentType,
} from '../app/functions/spark';
import {
  addSingleSparkTransaction,
  bulkUpdateSparkTransactions,
  cleanStalePendingSparkLightningTransactions,
  deleteUnpaidSparkLightningTransaction,
  getAllSparkTransactions,
  getAllUnpaidSparkLightningInvoices,
  SPARK_TX_UPDATE_ENVENT_NAME,
  sparkTransactionsEventEmitter,
} from '../app/functions/spark/transactions';
import {useAppStatus} from './appStatus';
import {restoreSparkTxState} from '../app/functions/spark/restore';
import {transformTxToPaymentObject} from '../app/functions/spark/transformTxToPayment';

// Initiate context
const SparkWalletManager = createContext(null);

const SparkWalletProvider = ({children}) => {
  const {didGetToHomepage} = useAppStatus();
  const [sparkInformation, setSparkInformation] = useState({
    balance: 0,
    transactions: [],
    identityPubKey: '',
    sparkAddress: '',
    didConnect: null,
  });
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const depositAddressIntervalRef = useRef(null);
  const cleanDBStateRef = useRef(null);
  const restoreOffllineStateRef = useRef(null);
  const sparkReceiveListenerRef = useRef(null);
  const sparkSendListenerRef = useRef(null);
  const [blockedIdentityPubKeys, setBlockedIdentityPubKeys] = useState([]);

  const handleTransactionUpdate = async recevedTxId => {
    try {
      // First we need to get recent spark transfers
      const transactions = await getSparkTransactions(5, undefined);
      if (!transactions)
        throw new Error('Unable to get transactions from spark');

      const {transfers} = transactions;
      const selectedSparkTransaction = transfers.find(
        tx => tx.id === recevedTxId,
      );

      console.log(
        selectedSparkTransaction,
        'received transaction from spark tx list',
      );
      let paymentObject = {};
      const paymentType = useSparkPaymentType(selectedSparkTransaction);

      if (paymentType === 'lightning') {
        const unpaidInvoices = await getAllUnpaidSparkLightningInvoices();
        const posibleOptions = unpaidInvoices.filter(
          unpaidInvoice =>
            unpaidInvoice.amount == selectedSparkTransaction.totalValue,
        );

        let matchedUnpaidInvoice = null;
        let savedInvoice = null;
        for (const invoice of posibleOptions) {
          console.log('Checking invoice', invoice);

          let paymentDetials;
          let attempts = 0;

          // Try up to 5 times with 1 second delay if transfer is undefined
          while (attempts < 5) {
            const result = await getSparkLightningPaymentStatus({
              lightningInvoiceId: invoice.sparkID,
            });

            // If transfer is defined, assign and break out of while loop
            if (result.transfer !== undefined) {
              paymentDetials = result;
              break;
            }

            // Wait 1 second before next attempt
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }

          // If paymentDetials is still undefined after 5 tries, continue to next invoice
          if (!paymentDetials || !paymentDetials.transfer) continue;

          console.log(paymentDetials, 'payment details');

          if (paymentDetials.transfer.sparkId === recevedTxId) {
            savedInvoice = invoice;
            matchedUnpaidInvoice = paymentDetials;
            break;
          }
        }

        if (savedInvoice) {
          // removes invoice from the unpaid list
          deleteUnpaidSparkLightningTransaction(savedInvoice.sparkID);
        }

        paymentObject = {
          id: recevedTxId,
          paymentStatus: 'completed',
          paymentType: 'lightning',
          accountId: selectedSparkTransaction.receiverIdentityPublicKey,
          details: {
            fee: 0,
            amount: selectedSparkTransaction.totalValue,
            address: matchedUnpaidInvoice?.invoice?.encodedInvoice || '',
            time: new Date().getTime(),
            direction: 'INCOMING',
            description: savedInvoice.description || '',
            preimage: matchedUnpaidInvoice?.paymentPreimage || '',
          },
        };
      } else if (paymentType === 'spark') {
        paymentObject = {
          id: recevedTxId,
          paymentStatus: 'completed',
          paymentType: 'spark',
          accountId: selectedSparkTransaction.receiverIdentityPublicKey,
          details: {
            fee: 0,
            amount: selectedSparkTransaction.totalValue,
            address: sparkInformation.sparkAddress,
            time: new Date().getTime(),
            direction: 'INCOMING',
            senderIdentityPublicKey:
              selectedSparkTransaction.senderIdentityPublicKey,
            description: '',
          },
        };
      }

      if (!selectedSparkTransaction)
        throw new Error('Not able to get recent transfer');

      const response = await addSingleSparkTransaction(paymentObject);

      if (response) {
        const txs = await getAllSparkTransactions();
        return {txs, paymentObject};
      } else false;
    } catch (err) {
      console.log('Handle incoming transaction error', err);
    }
  };

  const handleIncomingPayment = async transferId => {
    const balance = (await getSparkBalance()) || {balance: 0};
    const storedTransaction = await handleTransactionUpdate(transferId);
    setSparkInformation(prev => {
      return {
        ...prev,
        balance: balance.balance,
        transactions: storedTransaction
          ? storedTransaction.txs
          : prev.transactions,
      };
    });
    // block incoming paymetns here
    if (blockedIdentityPubKeys.includes(transferId)) return;
    // Handle confirm animation here
    setPendingNavigation({
      routes: [
        {
          name: 'HomeAdmin',
          params: {screen: 'Home'},
        },
        {
          name: 'ConfirmTxPage',
          params: {
            transaction: storedTransaction.paymentObject,
          },
        },
      ],
    });
  };

  // Add event listeners to listen for bitcoin and lightning or spark transfers when receiving does not handle sending
  useEffect(() => {
    if (!sparkInformation.didConnect) return;
    if (sparkReceiveListenerRef.current) return;
    sparkReceiveListenerRef.current = true;

    sparkWallet.on('transfer:claimed', (transferId, balance) => {
      console.log(`Transfer ${transferId} claimed. New balance: ${balance}`);
      handleIncomingPayment(transferId);
    });
    sparkWallet.on('deposit:confirmed', (transferId, balance) => {
      console.log(`Transfer ${transferId} claimed. New balance: ${balance}`);
      handleIncomingPayment(transferId);
    });
    return () => {
      sparkWallet.off('transfer:claimed');
      sparkWallet.off('deposit:confirmed');
    };
  }, [sparkInformation]);

  useEffect(() => {
    if (!sparkInformation.didConnect) return;
    if (sparkSendListenerRef.current) return;
    sparkSendListenerRef.current = true;

    async function handleUpdate(updateType) {
      try {
        const balance = (await getSparkBalance()) || {balance: 0};
        const txs = await getAllSparkTransactions();
        setSparkInformation(prev => {
          return {
            ...prev,
            balance: balance.balance,
            transactions: txs ? txs : prev.transactions,
          };
        });
      } catch (err) {
        console.log('error in spark handle db update function', err);
      }
    }
    sparkTransactionsEventEmitter.off(
      SPARK_TX_UPDATE_ENVENT_NAME,
      handleUpdate,
    );
    sparkTransactionsEventEmitter.on(SPARK_TX_UPDATE_ENVENT_NAME, handleUpdate);

    return () => {
      sparkTransactionsEventEmitter.off(
        SPARK_TX_UPDATE_ENVENT_NAME,
        handleUpdate,
      );
    };
  }, [sparkInformation]);

  useEffect(() => {
    // Interval to check deposit addresses to see if they were paid
    const handleDepositAddressCheck = async () => {
      try {
        console.log('l1Deposit check running....');
        const depoistAddresses = await getUnusedSparkBitcoinL1Address();
        console.log('Reteived deposit addresses', depoistAddresses);
        if (!depoistAddresses || !depoistAddresses.length) return;
        const newTransactions = await Promise.all(
          depoistAddresses.map(async address => {
            const response = await claimSparkBitcoinL1Transaction(address);
            // make sure to add address to tx item and format it like it needs to be for the sql database
            console.log('Bitcoin claim response', response);
            if (!response) return false;
            return response;
          }),
        );
        const filteredTxs = newTransactions.filter(Boolean);

        // Eventualy save the claimed txs to the transaction array
      } catch (err) {
        console.log('Handle deposit address check error', err);
      }
    };

    if (depositAddressIntervalRef.current) {
      clearInterval(depositAddressIntervalRef.current);
    }
    return;
    depositAddressIntervalRef.current = setInterval(
      handleDepositAddressCheck,
      1_000 * 60,
    );
    return () => {
      clearInterval(depositAddressIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    // This function runs once per load and check to see if there are any stale lightning payments inside of the sql database.
    if (!didGetToHomepage) return;
    if (cleanDBStateRef.current) return;
    cleanDBStateRef.current = true;
    cleanStalePendingSparkLightningTransactions();
  }, [didGetToHomepage]);

  useEffect(() => {
    // This function runs once per load and check to see if a user received any payments while offline.
    if (!didGetToHomepage) return;
    if (restoreOffllineStateRef.current) return;
    restoreOffllineStateRef.current = true;

    async function restoreTxState() {
      const restored = await restoreSparkTxState(50);
      console.log(restored.txs);
      if (!restored.txs.length) return;

      const newPaymentObjects = [];

      for (const tx of restored.txs) {
        const paymentObject = await transformTxToPaymentObject(
          tx,
          sparkInformation.sparkAddress,
        );
        if (paymentObject) {
          newPaymentObjects.push(paymentObject);
        }
      }

      if (newPaymentObjects.length) {
        await bulkUpdateSparkTransactions(newPaymentObjects);

        const [txs, balance] = await Promise.all([
          getAllSparkTransactions(),
          getSparkBalance(),
        ]);

        setSparkInformation(prev => ({
          ...prev,
          balance: balance?.balance || prev.balance,
          transactions: txs,
        }));
      }
    }

    restoreTxState();
  }, [didGetToHomepage]);

  const contextValue = useMemo(
    () => ({
      sparkInformation,
      setSparkInformation,
      setBlockedIdentityPubKeys,
      pendingNavigation,
      setPendingNavigation,
    }),
    [
      sparkInformation,
      setSparkInformation,
      setBlockedIdentityPubKeys,
      pendingNavigation,
      setPendingNavigation,
    ],
  );

  return (
    <SparkWalletManager.Provider value={contextValue}>
      {children}
    </SparkWalletManager.Provider>
  );
};

function useSparkWallet() {
  const context = useContext(SparkWalletManager);
  if (!context) {
    throw new Error('useSparkWallet must be used within a SparkWalletProvider');
  }
  return context;
}

export {SparkWalletManager, SparkWalletProvider, useSparkWallet};
