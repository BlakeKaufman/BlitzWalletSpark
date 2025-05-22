import {lnurlWithdraw} from '@breeztech/react-native-breez-sdk-liquid';
import {
  crashlyticsLogReport,
  crashlyticsRecordErrorReport,
} from '../../../../../functions/crashlyticsLogs';

export default async function processLNUrlWithdraw(input, context) {
  const {goBackFunction, setLoadingMessage} = context;
  crashlyticsLogReport('Begining LNURL withdrawl process');
  setLoadingMessage('Starting LNURL withdrawl');

  try {
    const amountMsat = input.data.minWithdrawable;
    await lnurlWithdraw({
      data: input.data,
      amountMsat,
      description: 'Withdrawl',
    });
  } catch (err) {
    console.log('process lnurl withdrawls error', err);
    crashlyticsRecordErrorReport(err.message);
    goBackFunction(err.message);
  }
}
