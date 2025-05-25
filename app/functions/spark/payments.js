import {
  getSparkLightningSendRequest,
  getSparkTransactions,
  sendSparkPayment,
  sparkWallet,
} from '.';
import {BLITZ_SUPPORT_DEFAULT_PAYMENT_DESCRIPTION} from '../../constants';
import {
  BLITZ_FEE_PERCET,
  BLITZ_FEE_SATS,
  SPARK_TO_LN_FEE,
  SPARK_TO_SPARK_FEE,
} from '../../constants/math';
import {
  addSingleSparkTransaction,
  addSingleUnpaidSparkLightningTransaction,
  bulkUpdateSparkTransactions,
} from './transactions';

export const sparkPaymenWrapper = async ({
  getFee = false,
  address,
  paymentType,
  amountSats = 0,
  exitSpeed = 'FAST',
  masterInfoObject,
  fee,
  memo,
  userBalance = 0,
  sparkInformation,
}) => {
  try {
    console.log('Begining spark payment');
    if (!sparkWallet) throw new Error('sparkWallet not initialized');
    const supportFee =
      Math.ceil(
        amountSats * masterInfoObject?.enabledDeveloperSupport.baseFeePercent,
      ) + Number(masterInfoObject?.enabledDeveloperSupport?.baseFee);
    if (getFee) {
      console.log('Calculating spark payment fee');
      let calculatedFee = 0;
      if (paymentType === 'lightning') {
        const routingFee = await sparkWallet.getLightningSendFeeEstimate({
          encodedInvoice: address,
        });
        calculatedFee = routingFee + amountSats * SPARK_TO_LN_FEE;
      } else if (paymentType === 'bitcoin') {
        const feeResponse = await sparkWallet.getWithdrawalFeeEstimate({
          amountSats,
          withdrawalAddress: address,
        });
        calculatedFee =
          feeResponse.speedFast.userFee.originalValue +
          feeResponse.speedFast.l1BroadcastFee.originalValue;
      } else {
        // Spark payments
        const feeResponse = await sparkWallet.getSwapFeeEstimate(amountSats);
        calculatedFee =
          feeResponse.feeEstimate.originalValue || SPARK_TO_SPARK_FEE;
      }
      return {
        didWork: true,
        fee: Math.round(calculatedFee),
        supportFee: Math.round(supportFee),
      };
    }
    let response;
    if (userBalance < amountSats + (paymentType === 'bitcoin' ? 0 : fee))
      throw new Error('Insufficient funds');

    let supportFeeResponse;

    if (paymentType === 'lightning') {
      const lightningPayResponse = await sparkWallet.payLightningInvoice({
        invoice: address,
      });
      if (!lightningPayResponse)
        throw new Error('Error when sending lightning payment');

      // if (masterInfoObject?.enabledDeveloperSupport?.isEnabled) {
      //   sendSparkPayment({
      //     receiverSparkAddress: process.env.BLITZ_SPARK_SUPPORT_ADDRESSS,
      //     amountSats: supportFee,
      //   });
      // }

      console.log(lightningPayResponse, 'lightning pay response');
      let sparkQueryResponse = null;
      let count = 0;
      while (!sparkQueryResponse && count < 5) {
        const sparkResponse = await getSparkLightningSendRequest(
          lightningPayResponse.id,
        );

        if (sparkResponse.transfer) {
          sparkQueryResponse = sparkResponse;
        } else {
          console.log('Waiting for response...');
          await new Promise(res => setTimeout(res, 2000));
        }
        count += 1;
      }

      console.log(sparkQueryResponse, 'AFTEWR');
      const tx = {
        id: sparkQueryResponse
          ? sparkQueryResponse.transfer.sparkId
          : lightningPayResponse.id,
        paymentStatus: sparkQueryResponse ? 'completed' : 'pending',
        paymentType: 'lightning',
        accountId: sparkInformation.identityPubKey,
        details: {
          fee: fee,
          amount: amountSats,
          address: lightningPayResponse.encodedInvoice,
          time: new Date(lightningPayResponse.updatedAt).getTime(),
          direction: 'OUTGOING',
          description: memo || '',
          preImage: sparkQueryResponse
            ? sparkQueryResponse.paymentPreimage
            : '',
        },
      };
      response = tx;

      await addSingleSparkTransaction(tx);
    } else if (paymentType === 'bitcoin') {
      // make sure to import exist speed
      const [onChainPayResponse, supportFeeRes] = await Promise.all([
        sparkWallet.withdraw({
          onchainAddress: address,
          exitSpeed,
          amountSats,
        }),
        masterInfoObject?.enabledDeveloperSupport?.isEnabled
          ? sendSparkPayment({
              receiverSparkAddress: process.env.BLITZ_SPARK_SUPPORT_ADDRESSS,
              amountSats: supportFee,
            })
          : Promise.resolve(null),
      ]);
      supportFeeResponse = supportFeeRes;
      response = await updatePaymentsState(
        onChainPayResponse,
        supportFeeRes,
        fee,
        memo,
        address,
        'BITCOIN_WITHDRAWAL',
      );
    } else {
      const sparkPayResponse = await sendSparkPayment({
        receiverSparkAddress: address,
        amountSats,
      });

      if (!sparkPayResponse)
        throw new Error('Error when sending spark payment');

      console.log('Spark payment response', sparkPayResponse);

      // if (masterInfoObject?.enabledDeveloperSupport?.isEnabled) {
      //   sendSparkPayment({
      //     receiverSparkAddress: process.env.BLITZ_SPARK_SUPPORT_ADDRESSS,
      //     amountSats: supportFee,
      //   });
      // }

      const tx = {
        id: sparkPayResponse.id,
        paymentStatus: 'completed',
        paymentType: 'spark',
        accountId: sparkPayResponse.senderIdentityPublicKey,
        details: {
          fee: fee,
          amount: amountSats,
          address: address,
          time: new Date(sparkPayResponse.updatedTime).getTime(),
          direction: 'OUTGOING',
          description: memo || '',
          senderIdentityPublicKey: sparkPayResponse.receiverIdentityPublicKey,
        },
      };
      response = tx;
      await addSingleSparkTransaction(tx);
    }
    console.log(response, 'resonse in send function');
    return {didWork: true, response};
  } catch (err) {
    console.log('Send lightning payment error', err);
    return {didWork: false, error: err.message};
  }
};

export const sparkReceivePaymentWrapper = async ({
  amountSats,
  memo,
  paymentType,
}) => {
  try {
    if (!sparkWallet) throw new Error('sparkWallet not initialized');

    if (paymentType === 'lightning') {
      const invoice = await sparkWallet.createLightningInvoice({
        amountSats,
        memo,
        expirySeconds: 1000 * 60 * 60 * 24, //Add 24 hours validity to invoice
      });

      const tempTransaction = {
        id: invoice.id,
        amount: amountSats,
        expiration: invoice.invoice.expiresAt,
        description: memo || '',
      };
      await addSingleUnpaidSparkLightningTransaction(tempTransaction);
      return {
        didWork: true,
        data: invoice,
        invoice: invoice.invoice.encodedInvoice,
      };
    } else if (paymentType === 'bitcoin') {
      // Handle storage of tx when claiming in spark context
      const depositAddress = await sparkWallet.getSingleUseDepositAddress();
      return {
        didWork: true,
        invoice: depositAddress,
      };
    } else {
      // No need to save address since it is constant
      const sparkAddress = await sparkWallet.getSparkAddress();
      return {
        didWork: true,
        invoice: sparkAddress,
      };
    }
  } catch (err) {
    console.log('Receive spark payment error', err);
    return {didWork: false, error: err.message};
  }
};

const updatePaymentsState = async (
  outgoinPayment,
  supportFeePayment,
  fee,
  memo,
  address,
  type,
) => {
  try {
    await new Promise(res => setTimeout(res, 1000));
    const transactions = await getSparkTransactions(5);
    const txHistoryOutgoing =
      transactions.find(
        tx =>
          new Date(tx.createdTime).getTime() ===
          new Date(outgoinPayment.createdAt).getTime(),
      ) || {};
    const txHistorySupport = supportFeePayment
      ? transactions.find(
          tx =>
            new Date(tx.createdTime).getTime() ===
            new Date(supportFeePayment.createdTime).getTime(),
        ) || {}
      : null;

    const storedPayment = {
      ...outgoinPayment,
      ...txHistoryOutgoing,
      fee: fee,
      address,
      description: memo,
    };

    const supportStoredPayment = supportFeePayment
      ? {
          ...supportFeePayment,
          ...txHistorySupport,
          description: BLITZ_SUPPORT_DEFAULT_PAYMENT_DESCRIPTION,
          address: process.env.BLITZ_SPARK_SUPPORT_ADDRESSS,
          fee: SPARK_TO_SPARK_FEE,
        }
      : null;

    const updates = supportStoredPayment
      ? [storedPayment, supportStoredPayment]
      : [storedPayment];

    await bulkUpdateSparkTransactions(updates);

    return storedPayment;
  } catch (err) {
    console.log('update payment state error', err);
    return outgoinPayment;
  }
};
