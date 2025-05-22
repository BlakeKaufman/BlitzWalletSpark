import {createContext, useContext, useEffect, useMemo, useRef} from 'react';
import {useGlobalContextProvider} from './context';
import {
  collection,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import {db} from '../db/initializeFirebase';
import {batchDeleteLnurlPayments, getLnurlPayments} from '../db';

export default function HandleLNURLPayments() {
  const {masterInfoObject} = useGlobalContextProvider();
  const {lnurlPubKey} = masterInfoObject;
  const loadListener = useRef(null);
  const didRunSavedlNURL = useRef(null);

  useEffect(() => {
    async function getSavedLNURLPayments() {
      const payments = await getLnurlPayments(masterInfoObject.uuid);
      if (!payments.length) return;
      console.log(payments, 'LNURL Payments');
      // loop through payments here
      let deletedPaymentIds = [];
      for (let index = 0; index < payments.length; index++) {
        const payment = payments[index];
        console.log(payment);
        // if (
        // ) {
        //   deletedPaymentIds.push(payment.id);
        // }
        // initialize temporary spark wallet
        // send senderpubkey to spark wallet listener to block confirm nativagion
        // send from temp spark wallet to self
        // if confirmed delte from db
        // if balance is 0 and payment has expired delte from db
      }
      if (deletedPaymentIds.length) {
        await batchDeleteLnurlPayments(
          masterInfoObject.uuid,
          deletedPaymentIds,
        );
      }
    }
    if (!masterInfoObject.uuid) return;
    if (didRunSavedlNURL.current) return;
    didRunSavedlNURL.current = true;
    getSavedLNURLPayments();

    console.log('LNRL PAYMENTS', lnurlPubKey);
  }, [masterInfoObject]);

  useEffect(() => {
    if (!masterInfoObject.uuid) return;
    if (loadListener.current) return;
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
        async function handleSnapshot() {
          if (!snapshot) return;
          const newPayment = snapshot.docChanges();
          if (!newPayment.length) return;
          for (let index = 0; index < newPayment.length; index++) {
            const change = newPayment[index];
            if (change.type === 'added') {
              const payment = change.doc.data();
              console.log(payment, 'new LNURL payment');
              // initialize temporary spark wallet
              // send senderpubkey to spark wallet listener to block confirm nativagion
              // send from temp spark wallet to self
              // if confirmed delte from db
              // if(didPay){
              //   await batchDeleteLnurlPayments(
              //     masterInfoObject.uuid,
              //     [payment.id],
              //   );
              // }
            }
          }
        }
        handleSnapshot();
      },
      error => {
        console.error('Error fetching payments:', error);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [masterInfoObject]);

  return null;
}
