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
  getSparkTransactions,
  getUnusedSparkBitcoinL1Address,
  sparkWallet,
} from '../app/functions/spark';
import {
  bulkUpdateSparkTransactions,
  cleanStalePendingSparkLightningTransactions,
  getAllSparkTransactions,
  SPARK_TX_UPDATE_ENVENT_NAME,
  sparkTransactionsEventEmitter,
} from '../app/functions/spark/transactions';
import {useAppStatus} from './appStatus';

// Initiate context
const SparkWalletManager = createContext(null);

const SparkWalletProvider = ({children}) => {
  const {didGetToHomepage} = useAppStatus();
  const [sparkInformation, setSparkInformation] = useState({
    balance: 0,
    transactions: [],
    didConnect: null,
  });
  const depositAddressIntervalRef = useRef(null);
  const cleanDBStateRef = useRef(null);
  const sparkReceiveListenerRef = useRef(null);
  const sparkSendListenerRef = useRef(null);

  const handleTransactionUpdate = async recevedTxId => {
    try {
      // First we need to get recent spark transfers
      const transactions = await getSparkTransactions(5, undefined);
      if (!transactions)
        throw new Error('Unable to get transactions from spark');
      const selectedSparkTransaction = transactions.filter(
        tx => tx.id === recevedTxId,
      );

      // Posibly need to format spark transactions to match DB
      // {
      //   id: string;
      //   senderIdentityPublicKey: string;
      //   receiverIdentityPublicKey: string;
      //   status: string;
      //   createdTime: number | string; // timestamp or ISO string
      //   updatedTime?: number | string;
      //   type: string;
      //   transferDirection: string;
      //   totalValue: number;
      //   initial_sent?: number;
      //   description?: string;
      //   fee?: number;
      // }

      if (!selectedSparkTransaction.length)
        throw new Error('Not able to get recent transfer');

      // This will update lightning txs to add the reqiured information but save the payumetn description. And this will add spark or bitcoin transactions since no previous information is added
      const response = await bulkUpdateSparkTransactions(
        selectedSparkTransaction,
      );

      if (response) {
        const txs = await getAllSparkTransactions();
        return txs;
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
        transactions: storedTransaction ? storedTransaction : prev.transactions,
      };
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

  const contextValue = useMemo(
    () => ({
      sparkInformation,
      setSparkInformation,
    }),
    [sparkInformation, setSparkInformation],
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
