import {InputTypeVariant} from '@breeztech/react-native-breez-sdk-liquid';
import {SATSPERBITCOIN} from '../../../../../constants';
import {crashlyticsLogReport} from '../../../../../functions/crashlyticsLogs';

export default function processLNUrlPay(input, context) {
  const {masterInfoObject, comingFromAccept, enteredPaymentInfo, fiatStats} =
    context;

  crashlyticsLogReport('Beiging decode LNURL pay');
  const amountMsat = comingFromAccept
    ? enteredPaymentInfo.amount * 1000
    : input.data.minSendable;
  const fiatValue =
    Number(amountMsat / 1000) / (SATSPERBITCOIN / (fiatStats?.value || 65000));

  return {
    data: comingFromAccept
      ? {...input.data, message: enteredPaymentInfo.description}
      : input.data,
    type: InputTypeVariant.LN_URL_PAY,
    paymentNetwork: 'lightning',

    sendAmount: `${
      masterInfoObject.userBalanceDenomination != 'fiat'
        ? `${Math.round(amountMsat / 1000)}`
        : fiatValue < 0.01
        ? ''
        : `${fiatValue.toFixed(2)}`
    }`,
    canEditPayment: !comingFromAccept,
  };
}
