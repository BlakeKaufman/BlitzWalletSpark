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
import {retrieveData} from '../app/functions';

export default function HandleLNURLPayments() {
  const {
    setBlockedIdentityPubKeys,
    sparkInformation,
    setNumberOfIncomingLNURLPayments,
  } = useSparkWallet();
  const {masterInfoObject} = useGlobalContextProvider();
  const {lnurlPubKey} = masterInfoObject;
  const sparkAddress = sparkInformation.sparkAddress;
  const loadListener = useRef(null);
  const didRunSavedlNURL = useRef(null);
  const [privateKey, setPrivateKey] = useState(null);
  const didCreateSessionPrivateKey = useRef(null);
  const paymentQueueRef = useRef([]);
  const tempWalletCacheRef = useRef(new Map());
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
  }, [masterInfoObject.uuid]);

  useEffect(() => {
    async function getSavedLNURLPayments() {
      const payments = await getLnurlPayments(masterInfoObject.uuid);
      if (!payments.length) return;
      console.log(`Restoring ${payments.length} offline lnurl payments`);
      // loop through payments here and add them to the queue list
      for (let index = 0; index < payments.length; index++) {
        const payment = payments[index];
        paymentQueueRef.current.push({
          ...payment,
          id: payment.id,
          shouldNavigate: false,
        });
        return;
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
            paymentQueueRef.current.push({
              ...payment,
              id: change.doc.id,
              shouldNavigate: true,
            });
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
      console.log(
        'LNURL payment queue claim length',
        paymentQueueRef.current.length,
      );
      setNumberOfIncomingLNURLPayments(paymentQueueRef.current.length);
      if (paymentQueueRef.current.length === 0) return;

      const newQueue = [];
      for (const payment of paymentQueueRef.current) {
        try {
          const derivedMnemonic = getSharedKey(
            privateKey,
            payment.sharedPublicKey,
          );

          let cached = tempWalletCacheRef.current.get(derivedMnemonic);

          let tempSparkWallet = cached?.wallet;
          if (!tempSparkWallet) {
            tempSparkWallet = await initializeTempSparkWallet(derivedMnemonic);
            if (!tempSparkWallet) {
              newQueue.push(payment);
              continue;
            }
            tempWalletCacheRef.current.set(derivedMnemonic, {
              wallet: tempSparkWallet,
            });
          }

          const balance = await tempSparkWallet.getBalance();
          if (Number(balance.balance) === 0) {
            newQueue.push(payment);
            continue;
          }

          const paymentResponse = await tempSparkWallet.transfer({
            amountSats: Number(balance.balance),
            receiverSparkAddress: sparkAddress,
          });
          console.log(
            'LNURL internal transfer payment response from queue',
            paymentResponse,
          );

          if (!paymentResponse) {
            newQueue.push(payment);
            continue;
          }

          const shouldNavigate =
            payment.shouldNavigate &&
            paymentQueueRef.current.filter(
              queueItem =>
                queueItem.id !== payment.id && queueItem.shouldNavigate,
            ).length === 0;

          setBlockedIdentityPubKeys(prev => {
            if (prev.some(p => p.id === transferResponse.id)) return prev;
            return [
              ...prev,
              {
                transferResponse: {...paymentResponse},
                db: payment,
                shouldNavigate: shouldNavigate,
              },
            ];
          });

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
    }, 10000);

    return () => clearInterval(interval);
  }, [privateKey, sparkAddress, masterInfoObject.uuid]);

  return null;
}
