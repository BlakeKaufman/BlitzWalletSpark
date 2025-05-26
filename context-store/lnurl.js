import {useEffect, useRef, useState, useCallback} from 'react';
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
  const sparkAddress = sparkInformation.sparkAddress;

  // Initialize refs
  const loadListener = useRef(false); // Changed to boolean for clarity
  const didRunSavedlNURL = useRef(false);
  const didCreateSessionPrivateKey = useRef(false);
  const timeoutRef = useRef(null);
  const isProcessingRef = useRef(false);

  // Use ref for payment queue to avoid dependency cycles
  const paymentQueueRef = useRef([]);
  const tempWalletCacheRef = useRef(new Map());
  const deleteActiveLNURLPaymentsRef = useRef([]);

  const [privateKey, setPrivateKey] = useState(null);

  // Initialize private key once
  useEffect(() => {
    if (!masterInfoObject.uuid) return;
    if (didCreateSessionPrivateKey.current) return;

    didCreateSessionPrivateKey.current = true;

    async function getSessionPrivateKey() {
      try {
        const userMnemonic = await retrieveData('mnemonic');
        if (!userMnemonic) {
          console.error('No mnemonic found');
          return;
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const derivedMnemonic = getBitcoinKeyPair(userMnemonic);
            setPrivateKey(derivedMnemonic.privateKey);
          });
        });
      } catch (error) {
        console.error('Error getting session private key:', error);
      }
    }

    getSessionPrivateKey();
  }, [masterInfoObject.uuid]);

  // Load saved LNURL payments once
  useEffect(() => {
    if (!privateKey || !sparkAddress) return;
    if (didRunSavedlNURL.current) return;

    didRunSavedlNURL.current = true;

    async function getSavedLNURLPayments() {
      try {
        const payments = await getLnurlPayments(masterInfoObject.uuid);
        if (!payments.length) return;

        console.log(`Restoring ${payments.length} offline lnurl payments`);

        for (let index = 0; index < payments.length; index++) {
          const payment = payments[index];
          paymentQueueRef.current.push({
            ...payment,
            id: payment.id,
            shouldNavigate: false,
            runCount: 0,
          });
        }

        setNumberOfIncomingLNURLPayments(
          prev => (prev += paymentQueueRef.current.length),
        );
        processQueue();
      } catch (error) {
        console.error('Error loading saved LNURL payments:', error);
      }
    }

    getSavedLNURLPayments();
  }, [privateKey, sparkAddress, masterInfoObject.uuid]);

  // Set up Firebase listener once
  useEffect(() => {
    if (!privateKey || !sparkAddress || loadListener.current) {
      return;
    }

    console.log(masterInfoObject.uuid, 'Setting up Firebase listener');
    loadListener.current = true;

    try {
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
          let hasNewPayments = false;

          snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
              const payment = change.doc.data();
              console.log(payment, 'Added to payment queue');

              paymentQueueRef.current.push({
                ...payment,
                id: change.doc.id,
                shouldNavigate: true,
                runCount: 0,
              });

              hasNewPayments = true;
            }
          });

          if (hasNewPayments) {
            setNumberOfIncomingLNURLPayments(
              prev => (prev += paymentQueueRef.current.length),
            );
            processQueue();
          }
        },
        error => {
          console.error('Error in Firebase listener:', error);
          // Attempt to reconnect after a delay
          setTimeout(() => {
            loadListener.current = false;
          }, 5000);
        },
      );
    } catch (error) {
      console.error('Error setting up Firebase listener:', error);
      loadListener.current = false;
    }
  }, [privateKey, sparkAddress, masterInfoObject.uuid]);

  // Process payment queue
  const processQueue = useCallback(async () => {
    if (!privateKey || !sparkAddress) return;
    if (isProcessingRef.current) return;

    isProcessingRef.current = true;

    try {
      const currentQueue = [...paymentQueueRef.current];
      setNumberOfIncomingLNURLPayments(currentQueue.length);
      console.log(`Processing ${currentQueue.length} LNURL payments`);

      if (currentQueue.length === 0) return;

      const newQueue = [];
      const processedIds = [];

      for (const payment of currentQueue) {
        console.log(`Processing LNURL payment ${payment.id}`);
        try {
          // Skip if run count exceeds limit
          if (payment.runCount >= 5) {
            console.log(`Payment ${payment.id} exceeded retry limit`);
            continue;
          }

          const derivedMnemonic = getSharedKey(
            privateKey,
            payment.sharedPublicKey,
          );

          let cached = tempWalletCacheRef.current.get(derivedMnemonic);
          let tempSparkWallet = cached?.wallet;

          if (!tempSparkWallet) {
            tempSparkWallet = await initializeTempSparkWallet(derivedMnemonic);
            if (!tempSparkWallet) {
              newQueue.push({...payment, runCount: payment.runCount + 1});
              continue;
            }

            tempWalletCacheRef.current.set(derivedMnemonic, {
              wallet: tempSparkWallet,
              timestamp: Date.now(),
            });
          }

          console.log(`Initialized LNULR wallet for ${payment.id}`);

          const balance = await tempSparkWallet.getBalance();

          console.log(`Has a balance of ${Number(balance.balance)}`);

          if (Number(balance.balance) === 0) {
            const now = new Date().getTime();

            if (payment.expiredTime < now) {
              processedIds.push(payment.id);
              deleteActiveLNURLPaymentsRef.current.push(payment.id);
              continue;
            }
            newQueue.push({...payment, runCount: payment.runCount + 1});
            continue;
          }

          const paymentResponse = await tempSparkWallet.transfer({
            amountSats: Number(balance.balance),
            receiverSparkAddress: sparkAddress,
          });

          if (!paymentResponse) {
            newQueue.push({...payment, runCount: payment.runCount + 1});
            continue;
          }

          const shouldNavigate =
            payment.shouldNavigate &&
            !processedIds.some(
              id => currentQueue.find(p => p.id === id)?.shouldNavigate,
            );

          setBlockedIdentityPubKeys(prev => {
            if (prev.some(p => p.transferResponse?.id === paymentResponse.id))
              return prev;
            return [
              ...prev,
              {
                transferResponse: {...paymentResponse},
                db: payment,
                shouldNavigate,
              },
            ];
          });

          processedIds.push(payment.id);
          deleteActiveLNURLPaymentsRef.current.push(payment.id);
        } catch (err) {
          console.error('Error processing payment:', payment.id, err);
          newQueue.push({...payment, runCount: payment.runCount + 1});
        }
      }

      // Update queue and clean up processed payments
      paymentQueueRef.current = paymentQueueRef.current
        .filter(
          item =>
            !processedIds.includes(item.id) &&
            !currentQueue.some(processed => processed.id === item.id),
        )
        .concat(newQueue);

      setNumberOfIncomingLNURLPayments(paymentQueueRef.current.length);

      if (deleteActiveLNURLPaymentsRef.current.length > 0) {
        try {
          await batchDeleteLnurlPayments(
            masterInfoObject.uuid,
            deleteActiveLNURLPaymentsRef.current,
          );
          deleteActiveLNURLPaymentsRef.current = [];
        } catch (error) {
          console.error('Error deleting processed payments:', error);
        }
      }

      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      for (const [key, value] of tempWalletCacheRef.current.entries()) {
        if (now - value.timestamp > oneHour) {
          tempWalletCacheRef.current.delete(key);
        }
      }

      if (newQueue.length > 0) {
        timeoutRef.current = setTimeout(() => {
          processQueue();
        }, 5000);
      }
    } catch (error) {
      console.error('Error in processQueue:', error);
    } finally {
      isProcessingRef.current = false;
    }
  }, [
    privateKey,
    sparkAddress,
    masterInfoObject.uuid,
    setNumberOfIncomingLNURLPayments,
    setBlockedIdentityPubKeys,
  ]);

  return null;
}
