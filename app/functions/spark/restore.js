import {getSparkBalance, getSparkPaymentStatus, getSparkTransactions} from '.';
import {LAST_LOADED_BLITZ_LOCAL_STOREAGE_KEY} from '../../constants';
import {getLocalStorageItem, setLocalStorageItem} from '../localStorage';
import {
  bulkUpdateSparkTransactions,
  getAllSparkTransactions,
} from './transactions';
import {transformTxToPaymentObject} from './transformTxToPayment';

export const restoreSparkTxState = async BATCH_SIZE => {
  let restoredTxs = [];
  try {
    let start = 0;
    const savedTxs = await getAllSparkTransactions();
    const savedIds = savedTxs?.map(tx => tx.sparkID) || [];

    let foundOverlap = false;

    do {
      const txs = await getSparkTransactions(start + BATCH_SIZE, start);
      const batchTxs = txs.transfers || [];

      if (!batchTxs.length) {
        console.log('No more transactions found, ending restore.');
        break;
      }

      // Check for overlap with saved transactions
      const overlap = batchTxs.some(tx => savedIds.includes(tx.id));

      if (overlap) {
        console.log('Found overlap with saved transactions, stopping restore.');
        foundOverlap = true;
      }

      restoredTxs.push(...batchTxs);
      start += BATCH_SIZE;
    } while (!foundOverlap);

    // Filter out any already-saved txs or dontation payments
    const newTxs = restoredTxs.filter(
      tx =>
        !savedIds.includes(tx.id) ||
        !(
          tx.transferDirection === 'OUTGOING' &&
          tx.receiverIdentityPublicKey === process.env.BLITZ_SPARK_PUBLICKEY
        ),
    );

    console.log(`Total restored transactions: ${restoredTxs.length}`);
    console.log(`New transactions after filtering: ${newTxs.length}`);
    return {txs: newTxs};
  } catch (error) {
    console.error('Error in spark restore history state:', error);
    return {txs: []};
  }
};
export const updateSparkTxStatus = async (
  BATCH_SIZE,
  useLastLoggedInTime = false,
) => {
  let restoredTxs = [];
  try {
    let start = 0;

    // Determine cutoff time
    // Arbitraily chose one week. Should be enough back time to cover last login if last login doesnt exist
    let historicalTime;
    if (useLastLoggedInTime) {
      historicalTime =
        JSON.parse(
          await getLocalStorageItem(LAST_LOADED_BLITZ_LOCAL_STOREAGE_KEY),
        ) || Date.now() - 7 * 24 * 60 * 60 * 1000;
      setLocalStorageItem(
        LAST_LOADED_BLITZ_LOCAL_STOREAGE_KEY,
        JSON.stringify(Date.now()),
      );
      console.log(
        'Using last logged-in time:',
        new Date(historicalTime).toISOString(),
      );
    } else {
      // go an hour back, should cover this sessions
      historicalTime = Date.now() - 60 * 60 * 1000;
      console.log(
        'Using last hour as cutoff:',
        new Date(historicalTime).toISOString(),
      );
    }

    // Get all saved transactions
    const savedTxs = await getAllSparkTransactions();
    const savedMap = new Map(savedTxs.map(tx => [tx.sparkID, tx])); // use sparkID as key

    while (true) {
      const txs = await getSparkTransactions(start + BATCH_SIZE, start);
      const batchTxs = txs.transfers || [];

      if (!batchTxs.length) {
        console.log('No more transactions found, ending restore.');
        break;
      }

      const recentTxs = batchTxs.filter(tx => {
        const txTime = new Date(tx.updatedTime).getTime();
        return txTime >= historicalTime;
      });

      if (recentTxs.length === 0) {
        console.log(
          'All remaining transactions are older than cutoff. Stopping restore.',
        );
        break;
      }

      restoredTxs.push(...recentTxs);
      start += BATCH_SIZE;
    }

    const updatedTxs = [];

    for (const tx of restoredTxs) {
      const saved = savedMap.get(tx.id);
      if (!saved) return;
      const status = getSparkPaymentStatus(tx.status);

      if (status !== saved.paymentStatus)
        updatedTxs.push({
          ...saved,
          paymentStatus: status,
          id: tx.id,
          details: JSON.parse(saved.details),
        }); // update existing tx with new status
    }

    if (updatedTxs.length) {
      await bulkUpdateSparkTransactions(updatedTxs);
    }

    console.log(`Total restored transactions: ${restoredTxs.length}`);
    console.log(`Updated transactions:`, updatedTxs);

    return {updated: updatedTxs};
  } catch (error) {
    console.error('Error in spark restore:', error);
    return {updated: []};
  }
};

export async function fullRestoreSparkState({sparkAddress}) {
  try {
    const restored = await restoreSparkTxState(50);
    if (!restored.txs.length) return;

    const newPaymentObjects = [];

    for (const tx of restored.txs) {
      const paymentObject = await transformTxToPaymentObject(tx, sparkAddress);
      if (paymentObject) {
        newPaymentObjects.push(paymentObject);
      }
    }

    if (newPaymentObjects.length) {
      // Update DB state of payments but dont hold up thread
      bulkUpdateSparkTransactions(newPaymentObjects);
    }
    const [txs, balance] = await Promise.all([
      getAllSparkTransactions(),
      getSparkBalance(),
    ]);

    return {
      balance: balance?.balance,
      txs: txs,
    };
  } catch (err) {
    console.log('full restore spark state error', err);
    return {
      balance: null,
      txs: null,
    };
  }
}
