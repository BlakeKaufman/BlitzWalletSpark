import * as SQLite from 'expo-sqlite';
import EventEmitter from 'events';
export const SPARK_TRANSACTIONS_DATABASE_NAME = 'SPARK_INFORMATION_DATABASE';
export const SPARK_TRANSACTIONS_TABLE_NAME = 'SPARK_TRANSACTIONS';
export const LIGHTNING_REQUEST_IDS_TABLE_NAME = 'LIGHTNING_REQUEST_IDS';
export const sparkTransactionsEventEmitter = new EventEmitter();
export const SPARK_TX_UPDATE_ENVENT_NAME = 'UPDATE_SPARK_STATE';

let sqlLiteDB;

if (!sqlLiteDB) {
  async function openDBConnection() {
    sqlLiteDB = await SQLite.openDatabaseAsync(
      `${SPARK_TRANSACTIONS_DATABASE_NAME}.db`,
    );
  }
  openDBConnection();
}

export const initializeSparkDatabase = async () => {
  try {
    await sqlLiteDB.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS ${SPARK_TRANSACTIONS_TABLE_NAME} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sparkID TEXT NOT NULL,
        paymentStatus TEXT NOT NULL,
        paymentType TEXT NOT NULL,
        accountId TEXT NOT NULL,
        details TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${LIGHTNING_REQUEST_IDS_TABLE_NAME} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sparkID TEXT NOT NULL,
        amount INTEGER NOT NULL,
        expiration INTEGER NOT NULL
      );
    `);

    console.log('Opened spark transaction and contacts tables');
    return true;
  } catch (err) {
    console.log('Database initialization failed:', err);
    return false;
  }
};

export const getAllSparkTransactions = async () => {
  try {
    const result = await sqlLiteDB.getAllAsync(
      `SELECT * FROM ${SPARK_TRANSACTIONS_TABLE_NAME}`,
    );
    return result;
  } catch (error) {
    console.error('Error fetching transactions:', error);
  }
};

export const getAllPendingSparkPayments = async () => {
  try {
    const result = await sqlLiteDB.getAllAsync(
      `SELECT * FROM ${SPARK_TRANSACTIONS_TABLE_NAME} WHERE paymentStatus = ?`,
      ['pending'],
    );
    return result;
  } catch (error) {
    console.error('Error fetching pending spark payments:', error);
    return [];
  }
};

export const getAllUnpaidSparkLightningInvoices = async () => {
  try {
    const result = await sqlLiteDB.getAllAsync(
      `SELECT * FROM ${LIGHTNING_REQUEST_IDS_TABLE_NAME}`,
    );
    return result;
  } catch (error) {
    console.error('Error fetching transactions:', error);
  }
};

export const updateSingleSparkTransaction = async (saved_spark_id, updates) => {
  // updates should be an object like { status: 'COMPLETED' }
  // saved_spark_id needs to match that of the stored transaction and then you can update the saved_id
  try {
    const fields = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');
    const values = Object.values(updates);

    await sqlLiteDB.runAsync(
      `UPDATE ${SPARK_TRANSACTIONS_TABLE_NAME} SET ${fields} WHERE sparkID = ?`,
      ...values,
      saved_spark_id,
    );
    return true;
  } catch (error) {
    console.error(`Error updating transaction at ${created_at_time}:`, error);
    return false;
  }
};

export const bulkUpdateSparkTransactions = async transactions => {
  if (!Array.isArray(transactions) || transactions.length === 0) return;

  try {
    await sqlLiteDB.execAsync('BEGIN TRANSACTION');
    for (const tx of transactions) {
      const sparkID = tx.id;
      const existingTx = await sqlLiteDB.getAsync(
        `SELECT * FROM ${SPARK_TRANSACTIONS_TABLE_NAME} 
         WHERE sparkID = ? 
         LIMIT 1`,
        sparkID,
      );

      const newDetails = formatDetailsJSON(tx);

      if (existingTx) {
        let existingDetails;
        try {
          existingDetails = JSON.parse(existingTx.details);
        } catch {
          existingDetails = {};
        }

        const mergedDetails = {...existingDetails, ...newDetails};

        await sqlLiteDB.runAsync(
          `UPDATE ${SPARK_TRANSACTIONS_TABLE_NAME}
           SET paymentStatus = ?, paymentType = ?, accountId = ?, details = ?
           WHERE sparkID = ?`,
          [
            newDetails.status,
            tx.paymentType ?? 'unknown',
            tx.accountId ?? 'unknown',
            JSON.stringify(mergedDetails),
            sparkID,
          ],
        );
      } else {
        await sqlLiteDB.runAsync(
          `INSERT INTO ${SPARK_TRANSACTIONS_TABLE_NAME}
           (sparkID, paymentStatus, paymentType, accountId, details)
           VALUES (?, ?, ?, ?, ?)`,
          [
            sparkID,
            newDetails.status,
            tx.paymentType ?? 'unknown',
            tx.accountId ?? 'unknown',
            JSON.stringify(newDetails),
          ],
        );
      }
    }

    await sqlLiteDB.execAsync('COMMIT');
    sparkTransactionsEventEmitter.emit(
      SPARK_TX_UPDATE_ENVENT_NAME,
      'transactions',
    );
    return true;
  } catch (error) {
    console.error('Error upserting transactions batch:', error);
    await sqlLiteDB.execAsync('ROLLBACK');
    return false;
  }
};

export const addSingleSparkTransaction = async tx => {
  if (!tx || !tx.id) {
    console.error('Invalid transaction object');
    return false;
  }

  try {
    const newDetails = formatDetailsJSON(tx);
    await sqlLiteDB.runAsync(
      `INSERT INTO ${SPARK_TRANSACTIONS_TABLE_NAME}
       (sparkID, paymentStatus, paymentType, accountId, details)
       VALUES (?, ?, ?, ?, ?)`,
      [
        tx.id,
        tx.status,
        tx.paymentType ?? 'unknown',
        tx.accountId ?? 'unknown',
        JSON.stringify(newDetails),
      ],
    );
    return true;
  } catch (error) {
    console.error('Error adding spark transaction:', error);
    return false;
  }
};

export const deleteSparkTransaction = async sparkID => {
  try {
    await sqlLiteDB.runAsync(
      `DELETE FROM ${SPARK_TRANSACTIONS_TABLE_NAME} WHERE sparkID = ?`,
      sparkID,
    );
    return true;
  } catch (error) {
    console.error(`Error deleting transaction ${sparkID}:`, error);
    return false;
  }
};
export const deletePendingSparkLightningTransaction = async sparkID => {
  try {
    await sqlLiteDB.runAsync(
      `DELETE FROM ${LIGHTNING_REQUEST_IDS_TABLE_NAME} WHERE sparkID = ?`,
      sparkID,
    );
    return true;
  } catch (error) {
    console.error(`Error deleting transaction ${sparkID}:`, error);
    return false;
  }
};

export const deleteSparkTransactionTable = async () => {
  try {
    await sqlLiteDB.execAsync(
      `DROP TABLE IF EXISTS ${SPARK_TRANSACTIONS_TABLE_NAME}`,
    );
    return true;
  } catch (error) {
    console.error('Error deleting spark_transactions table:', error);
    return false;
  }
};
export const deletePendingSparkLightningTransactionTable = async () => {
  try {
    await sqlLiteDB.execAsync(
      `DROP TABLE IF EXISTS ${LIGHTNING_REQUEST_IDS_TABLE_NAME}`,
    );
    return true;
  } catch (error) {
    console.error('Error deleting spark_transactions table:', error);
    return false;
  }
};

export const cleanStalePendingSparkLightningTransactions = async () => {
  try {
    const now = new Date().getTime();
    // Delete where status is 'INVOICE_CREATED' and expires_at_time is not null and in the past
    await sqlLiteDB.runAsync(
      `DELETE FROM ${LIGHTNING_REQUEST_IDS_TABLE_NAME}
       WHERE expiration < ?`,
      now,
    );
    console.log('Stale spark transactions cleaned up');
    return true;
  } catch (error) {
    console.error('Error cleaning stale spark transactions:', error);
    return false;
  }
};

const formatDetailsJSON = tx => {
  const newDetails = {
    direction: tx.transferDirection ?? null,
    fee: tx.fee ?? 0,
    address: tx.address ?? '',
    amount: tx.totalValue ?? 0,
    paymentTime: tx.updatedTime ?? tx.createdTime ?? Date.now(),
    description: tx.description ?? '',
    status: tx.status ?? 'pending',
    sparkID: tx.id ?? '',
    l1TxId: tx.l1TxId ?? null,
    preimage: tx.preimage ?? null,
    paymentHash: tx.paymentHash ?? null,
  };
  return newDetails;
};
