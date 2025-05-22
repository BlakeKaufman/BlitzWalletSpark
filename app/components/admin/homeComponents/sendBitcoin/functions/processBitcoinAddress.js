import {SATSPERBITCOIN} from '../../../../../constants';
import {
  crashlyticsLogReport,
  crashlyticsRecordErrorReport,
} from '../../../../../functions/crashlyticsLogs';
import {sparkPaymenWrapper} from '../../../../../functions/spark/payments';

export default async function processBitcoinAddress(input, context) {
  const {
    masterInfoObject,
    goBackFunction,
    comingFromAccept,
    enteredPaymentInfo,
  } = context;
  try {
    crashlyticsLogReport('Begining decode Bitcoin address');

    const amountSat = comingFromAccept
      ? enteredPaymentInfo.amount
      : input.address.amountSat || 0;

    const fiatValue =
      Number(amountSat) / (SATSPERBITCOIN / (fiatStats?.value || 65000));
    let newPaymentInfo = {
      address: input.address.address,
      amount: amountSat,
      label: input.address.label || '',
    };
    let paymentFee = 0;
    let supportFee = 0;
    if (amountSat) {
      const paymentFeeResponse = await sparkPaymenWrapper({
        getFee: true,
        address: input.address.address,
        paymentType: 'bitcoin',
        amountSats: amountSat,
        masterInfoObject,
      });

      if (paymentFeeResponse.didWork) {
        paymentFee = paymentFeeResponse.fee;
        supportFee = paymentFeeResponse.supportFeeResponse;
      } else {
        goBackFunction(`Sending amount is above your balance`);
        return;
      }
    }
    newPaymentInfo = {
      ...newPaymentInfo,
      fee: paymentFee,
      supportFee: supportFee,
    };

    return {
      data: newPaymentInfo,
      type: 'Bitcoin',
      paymentNetwork: 'Bitcoin',
      sendAmount: !amountSat
        ? ''
        : `${
            masterInfoObject.userBalanceDenomination != 'fiat'
              ? `${amountSat}`
              : fiatValue < 0.01
              ? ''
              : `${fiatValue.toFixed(2)}`
          }`,
      canEditPayment:
        comingFromAccept || input.address.amountSat ? false : true,
    };
  } catch (err) {
    console.log('process bitcoin address error', err);
    crashlyticsRecordErrorReport(err.message);
    return false;
  }
}
