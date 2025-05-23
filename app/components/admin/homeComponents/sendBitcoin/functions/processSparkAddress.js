import {SATSPERBITCOIN} from '../../../../../constants';
import {
  crashlyticsLogReport,
  crashlyticsRecordErrorReport,
} from '../../../../../functions/crashlyticsLogs';

import {sparkPaymenWrapper} from '../../../../../functions/spark/payments';

export default async function processSparkAddress(input, context) {
  const {
    masterInfoObject,
    comingFromAccept,
    enteredPaymentInfo,
    paymentInfo,
    fiatStats,
  } = context;
  try {
    crashlyticsLogReport('Handling decode spark payment');
    let addressInfo = JSON.parse(JSON.stringify(input?.address));

    console.log(addressInfo, 'SPARK INFO ADDRESS INFO', paymentInfo);

    if (comingFromAccept) {
      addressInfo.amount = enteredPaymentInfo.amount;
      addressInfo.label =
        enteredPaymentInfo.description || input?.address?.label || '';
      addressInfo.message =
        enteredPaymentInfo.description || input?.address?.message || '';
      addressInfo.isBip21 = true;
    }

    const amountMsat = comingFromAccept
      ? enteredPaymentInfo.amount * 1000
      : addressInfo.amount * 1000;
    const fiatValue =
      !!amountMsat &&
      Number(amountMsat / 1000) /
        (SATSPERBITCOIN / (fiatStats?.value || 65000));

    if (!paymentInfo.paymentFee || paymentInfo?.supportFee) {
      const fee = await sparkPaymenWrapper({
        getFee: true,
        address: addressInfo.address,
        paymentType: 'spark',
        amountSats: amountMsat / 1000,
        masterInfoObject,
      });
      if (fee.didWork) {
        addressInfo.paymentFee = fee.fee;
        addressInfo.supportFee = fee.supportFee;
      }
    }

    return {
      data: addressInfo,
      type: 'spark',
      paymentNetwork: 'spark',
      paymentFee: addressInfo.paymentFee,
      supportFee: addressInfo.supportFee,
      sendAmount: !amountMsat
        ? ''
        : `${
            masterInfoObject.userBalanceDenomination != 'fiat'
              ? `${Math.round(amountMsat / 1000)}`
              : fiatValue < 0.01
              ? ''
              : `${fiatValue.toFixed(2)}`
          }`,
      canEditPayment: comingFromAccept ? false : !amountMsat,
    };
  } catch (err) {
    console.log('process spark invoice error', err);
    crashlyticsRecordErrorReport(err.message);
  }
}
