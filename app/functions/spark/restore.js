import {getSparkBalance, getSparkTransactions} from '.';
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
    const savedIds = savedTxs?.map(tx => tx.spark_id) || [];

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

    // Filter out any already-saved txs
    const newTxs = restoredTxs.filter(tx => !savedIds.includes(tx.id));

    console.log(`Total restored transactions: ${restoredTxs.length}`);
    console.log(`New transactions after filtering: ${newTxs.length}`);
    return {txs: newTxs};
  } catch (error) {
    console.error('Error in spark restore history state:', error);
    return {txs: []};
  }
};

export async function fullRestoreSparkState({sparkAddress}) {
  try {
    const restored = await restoreSparkTxState(50);
    console.log(restored.txs);
    if (!restored.txs.length) return;

    const newPaymentObjects = [];

    for (const tx of restored.txs) {
      const paymentObject = await transformTxToPaymentObject(tx, sparkAddress);
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

      return {
        balance: balance?.balance,
        txs: txs,
      };
    }
  } catch (err) {
    console.log('full restore spark state error', err);
    return {
      balance: null,
      txs: null,
    };
  }
}
