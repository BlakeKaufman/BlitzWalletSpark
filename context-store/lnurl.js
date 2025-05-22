import {useEffect, useRef, useState} from 'react';
import {useGlobalContextProvider} from './context';
import {
  collection,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import {db} from '../db/initializeFirebase';
import {batchDeleteLnurlPayments, getLnurlPayments} from '../db';
import {initializeTempSparkWallet} from '../app/functions/spark';
import {getBitcoinKeyPair, getSharedKey} from '../app/functions/lnurl';
import {useSparkWallet} from './sparkContext';

export default function HandleLNURLPayments() {
  const {setBlockedIdentityPubKeys} = useSparkWallet();
  const {masterInfoObject} = useGlobalContextProvider();
  const {lnurlPubKey, contacts} = masterInfoObject;
  const sparkAddress = contacts?.myProfile?.sparkAddress;
  const loadListener = useRef(null);
  const didRunSavedlNURL = useRef(null);
  const [privateKey, setPrivateKey] = useState(null);
  const didCreateSessionPrivateKey = useRef(false);
  const paymentQueueRef = useRef([]);
  const deleteActiveLNURLPaymentsRef = useRef([]);

  useEffect(() => {
    if (!masterInfoObject.uuid) return;
    if (didCreateSessionPrivateKey.current) return;
    didCreateSessionPrivateKey.current = true;
    async function getSessionPrivateKey() {
      const userMnemoinc = await retrieveData('mnemonic');
      const derivedMnemonic = getBitcoinKeyPair(userMnemoinc);
      setPrivateKey(derivedMnemonic.privateKey);
    }
    getSessionPrivateKey();
  }, []);

  useEffect(() => {
    async function getSavedLNURLPayments() {
      const now = new Date().getTime();
      const payments = await getLnurlPayments(masterInfoObject.uuid);
      if (!payments.length) return;
      console.log(payments, 'LNURL Payments');
      // loop through payments here
      let deletedPaymentIds = [];
      for (let index = 0; index < payments.length; index++) {
        const payment = payments[index];
        const derivedMnemonic = getSharedKey(
          privateKey,
          payment.sharedPublicKey,
        );
        const combinedSparkWallet = await initializeTempSparkWallet(
          derivedMnemonic,
        );
        if (!combinedSparkWallet.isConnected) continue;

        const balance = await combinedSparkWallet.getBalance();

        if (balance.balance === 0) {
          if (payment.expiredTime < now) deletedPaymentIds.push(payment.id);
          continue;
        }

        try {
          const paymentResponse = await combinedSparkWallet.transfer({
            amountSats: balance.balance,
            recipient: sparkAddress,
          });

          if (!paymentResponse) throw new Error('Payment failed');
          setBlockedIdentityPubKeys(prev => {
            if (prev.includes(paymentResponse.id)) return prev;
            return [...prev, paymentResponse.id];
          });
          deletedPaymentIds.push(payment.id);
        } catch (err) {
          console.log('Error sending LNURL transfer payment', err);
        }
      }
      if (deletedPaymentIds.length) {
        await batchDeleteLnurlPayments(
          masterInfoObject.uuid,
          deletedPaymentIds,
        );
      }
    }
    if (!masterInfoObject.uuid) return;
    if (!privateKey) return;
    if (!sparkAddress) return;
    if (didRunSavedlNURL.current) return;
    didRunSavedlNURL.current = true;
    getSavedLNURLPayments();

    console.log('LNRL PAYMENTS', lnurlPubKey);
  }, [masterInfoObject, privateKey, sparkAddress]);

  useEffect(() => {
    if (
      !masterInfoObject.uuid ||
      !privateKey ||
      !sparkAddress ||
      loadListener.current
    )
      return;

    console.log(masterInfoObject.uuid, 'UUID for snapshot');
    loadListener.current = true;

    const paymentsRef = collection(
      db,
      'blitzWalletUsers',
      masterInfoObject.uuid,
      'lnurlPayments',
    );

    const now = new Date().getTime();
    const q = query(paymentsRef, where('timestamp', '>', now));

    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const payment = change.doc.data();
            console.log(payment, 'added to payment queue');
            paymentQueueRef.current.push(payment);
          }
        });
      },
      error => {
        console.error('Error fetching payments:', error);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [masterInfoObject, privateKey, sparkAddress]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!privateKey || !sparkAddress) return;
      if (paymentQueueRef.current.length === 0) return;

      const newQueue = [];
      for (const payment of paymentQueueRef.current) {
        try {
          const derivedMnemonic = getSharedKey(
            privateKey,
            payment.sharedPublicKey,
          );
          const tempSparkWallet = await initializeTempSparkWallet(
            derivedMnemonic,
          );

          if (!tempSparkWallet.isConnected) {
            newQueue.push(payment);
            continue;
          }

          const balance = await tempSparkWallet.getBalance();
          if (balance.balance === 0) {
            newQueue.push(payment);
            continue;
          }

          const paymentResponse = await tempSparkWallet.transfer({
            amountSats: balance.balance,
            recipient: sparkAddress,
          });

          if (!paymentResponse) {
            newQueue.push(payment);
            continue;
          }

          deleteActiveLNURLPaymentsRef.current.push(payment.id);
          console.log('Payment successful:', payment.id);
        } catch (err) {
          console.error('Error processing payment:', payment.id, err);
          newQueue.push(payment);
        }
      }

      paymentQueueRef.current = newQueue;

      if (deleteActiveLNURLPaymentsRef.current.length > 0) {
        await batchDeleteLnurlPayments(
          masterInfoObject.uuid,
          deleteActiveLNURLPaymentsRef.current,
        );
        deleteActiveLNURLPaymentsRef.current = [];
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [privateKey, sparkAddress, masterInfoObject.uuid]);

  return null;
}
