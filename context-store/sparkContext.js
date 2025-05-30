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
  deleteUnpaidSparkLightningTransaction,
  getAllSparkTransactions,
  getAllUnpaidSparkLightningInvoices,
  SPARK_TX_UPDATE_ENVENT_NAME,
  sparkTransactionsEventEmitter,
} from '../app/functions/spark/transactions';
import {useAppStatus} from './appStatus';
import {
  fullRestoreSparkState,
  updateSparkTxStatus,
} from '../app/functions/spark/restore';
import {transformTxToPaymentObject} from '../app/functions/spark/transformTxToPayment';
import {useGlobalContacts} from './globalContacts';
import {initWallet} from '../app/functions/initiateWalletConnection';

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
  const {toggleGlobalContactsInformation, globalContactsInformation} =
    useGlobalContacts();
  const [numberOfIncomingLNURLPayments, setNumberOfIncomingLNURLPayments] =
    useState(0);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const depositAddressIntervalRef = useRef(null);
  const restoreOffllineStateRef = useRef(null);
  const sparkPaymentActionsRef = useRef(null);
  const [blockedIdentityPubKeys, setBlockedIdentityPubKeys] = useState([]);
  const blockedIdentityPubKeysRef = useRef([]);
  const isFirstSparkUpdateStateInterval = useRef(true);
  const [numberOfCachedTxs, setNumberOfCachedTxs] = useState(0);
  const [numberOfConnectionTries, setNumberOfConnectionTries] = useState(0);

  useEffect(() => {
    blockedIdentityPubKeysRef.current = blockedIdentityPubKeys;
  }, [blockedIdentityPubKeys]);

  // This is a function that handles incoming transactions and formmataes it to reqirued formation
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
      } else {
        //Don't need to do anything here for bitcoin This gets hanldes by the payment state update which will turn it from pending to confirmed once one confirmation happens
      }

      if (!selectedSparkTransaction)
        throw new Error('Not able to get recent transfer');

      await addSingleSparkTransaction(paymentObject);

      const savedTxs = await getAllSparkTransactions();

      return {txs: savedTxs, paymentObject};
    } catch (err) {
      console.log('Handle incoming transaction error', err);
    }
  };

  const handleIncomingPayment = async transferId => {
    let storedTransaction = await handleTransactionUpdate(transferId);

    // block incoming paymetns here
    console.log(blockedIdentityPubKeysRef.current, 'blocked identy puib keys');
    const isLNURLPayment = blockedIdentityPubKeysRef.current.find(
      blocked => blocked.transferResponse.id === transferId,
    );
    console.log(isLNURLPayment, 'isLNURL PAYMNET');
    if (!!isLNURLPayment) {
      const selectedLNURL = storedTransaction.txs.find(
        tx => tx.sparkID === transferId,
      );
      const dbLNURL = isLNURLPayment.db;

      const newPayent = {
        ...selectedLNURL,
        details: {description: dbLNURL.description},
        id: selectedLNURL.sparkID,
      };

      await bulkUpdateSparkTransactions([newPayent]);

      if (!isLNURLPayment.shouldNavigate) return;
    }
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
    if (sparkPaymentActionsRef.current) return;
    sparkPaymentActionsRef.current = true;

    console.log('Running add spark listneers');

    async function handleUpdate(updateType) {
      try {
        console.log(
          'running update in spark context from db changes',
          updateType,
        );
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

    sparkTransactionsEventEmitter.on(SPARK_TX_UPDATE_ENVENT_NAME, handleUpdate);

    sparkWallet.on('transfer:claimed', (transferId, balance) => {
      console.log(`Transfer ${transferId} claimed. New balance: ${balance}`);
      handleIncomingPayment(transferId);
    });

    // sparkWallet.on('deposit:confirmed', (transferId, balance) => {
    //   console.log(`Transfer ${transferId} claimed. New balance: ${balance}`);
    //   handleIncomingPayment(transferId);
    // });
  }, [sparkInformation.didConnect]);

  useEffect(() => {
    if (!sparkInformation.didConnect) return;
    // Interval to check deposit addresses to see if they were paid
    const handleDepositAddressCheck = async () => {
      try {
        console.log('l1Deposit check running....');
        const depoistAddresses = await getUnusedSparkBitcoinL1Address();
        console.log(
          'Number of active deposit addresses:',
          depoistAddresses?.length,
        );
        if (!depoistAddresses || !depoistAddresses.length) return;
        const newTransactions = await Promise.all(
          depoistAddresses.map(async address => {
            const response = await claimSparkBitcoinL1Transaction(address);
            if (!response.filter(Boolean).length) return false;
            const [txid, [data]] = response;
            const formattedTx = await transformTxToPaymentObject(
              {
                ...data,
                transferDirection: 'INCOMING',
                address: address,
                txid: txid,
              },
              '',
              'bitcoin',
            );
            return formattedTx;
          }),
        );
        const filteredTxs = newTransactions.filter(Boolean);

        if (filteredTxs.length) {
          await bulkUpdateSparkTransactions(filteredTxs);
        }
      } catch (err) {
        console.log('Handle deposit address check error', err);
      }
    };

    if (depositAddressIntervalRef.current) {
      clearInterval(depositAddressIntervalRef.current);
    }

    depositAddressIntervalRef.current = setInterval(
      handleDepositAddressCheck,
      1_000 * 60,
    );
  }, [sparkInformation.didConnect]);

  useEffect(() => {
    // This function runs once per load and check to see if a user received any payments while offline. It also starts a timeout to update payment status of paymetns every 30 seconds.
    if (!didGetToHomepage) return;
    if (restoreOffllineStateRef.current) return;
    restoreOffllineStateRef.current = true;

    setInterval(async () => {
      try {
        console.log(
          'Is first interval',
          isFirstSparkUpdateStateInterval.current,
        );
        updateSparkTxStatus(50, isFirstSparkUpdateStateInterval.current);
        isFirstSparkUpdateStateInterval.current = false;
      } catch (err) {
        console.error('Error during periodic restore:', err);
      }
    }, 30000); // every 30 seconds

    async function restoreTxState() {
      await fullRestoreSparkState({
        sparkAddress: sparkInformation.sparkAddress,
      });
    }
    restoreTxState();
  }, [didGetToHomepage]);

  // This function connects to the spark node and sets the session up
  useEffect(() => {
    async function initProcess() {
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          const {didWork} = await initWallet({
            setSparkInformation,
            toggleGlobalContactsInformation,
            globalContactsInformation,
          });
          console.log(didWork, 'did connect to spark wallet in context');
        });
      });

      if (didWork) return;
      setNumberOfConnectionTries(prev => (prev += 1));
      await new Promise(
        () =>
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              initProcess();
            });
          }),
        2000,
      );
    }
    initProcess();
  }, []);

  const contextValue = useMemo(
    () => ({
      sparkInformation,
      setSparkInformation,
      setBlockedIdentityPubKeys,
      pendingNavigation,
      setPendingNavigation,
      numberOfIncomingLNURLPayments,
      setNumberOfIncomingLNURLPayments,
      numberOfConnectionTries,
      numberOfCachedTxs,
      setNumberOfCachedTxs,
    }),
    [
      sparkInformation,
      setSparkInformation,
      setBlockedIdentityPubKeys,
      pendingNavigation,
      setPendingNavigation,
      numberOfIncomingLNURLPayments,
      setNumberOfIncomingLNURLPayments,
      numberOfConnectionTries,
      numberOfCachedTxs,
      setNumberOfCachedTxs,
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
