import {Image, StyleSheet, View, TouchableOpacity, Text} from 'react-native';
import {
  BLITZ_DEFAULT_PAYMENT_DESCRIPTION,
  BLITZ_SUPPORT_DEFAULT_PAYMENT_DESCRIPTION,
  CENTER,
  COLORS,
  HIDDEN_BALANCE_TEXT,
  ICONS,
  SIZES,
} from '../constants';
import {ThemeText} from './CustomElements';
import FormattedSatText from './CustomElements/satTextDisplay';
import {useTranslation} from 'react-i18next';
import Icon from './CustomElements/Icon';
import {memo, useMemo} from 'react';
import {mergeArrays} from './mergeArrays';
import {crashlyticsLogReport} from './crashlyticsLogs';
import {
  isSparkDonationPayment,
  useIsSparkPaymentPending,
  useSparkPaymentType,
} from './spark';

export default function getFormattedHomepageTxsForSpark({
  // combinedTransactions,
  currentTime,
  sparkInformation,
  homepageTxPreferance = 25,
  navigate,
  // isBankPage,
  frompage,
  viewAllTxText,
  noTransactionHistoryText,
  todayText,
  yesterdayText,
  dayText,
  monthText,
  yearText,
  agoText,
  theme,
  darkModeType,
  userBalanceDenomination,
}) {
  crashlyticsLogReport('Starting re-rendering of formatted transactions');
  const sparkTransactions = sparkInformation?.transactions;
  const sparkTransactionsLength = sparkInformation?.transactions?.length;

  console.log(sparkTransactionsLength);
  console.log('re-rendering transactions');

  if (!sparkTransactionsLength) {
    return [
      <View style={[styles.noTransactionsContainer]} key={'noTx'}>
        <ThemeText
          content={noTransactionHistoryText}
          styles={{...styles.noTransactionsText}}
        />
      </View>,
    ];
  } else {
    let formattedTxs = [];
    let currentGroupedDate = '';
    let transactionIndex = 0;
    let didExcludeTxs = false;

    while (
      formattedTxs.length <
        (frompage === 'viewAllTx'
          ? sparkTransactionsLength
          : homepageTxPreferance) &&
      transactionIndex < sparkTransactionsLength
    ) {
      try {
        const currentTransaction = sparkTransactions[transactionIndex];
        const lastTransaction = sparkTransactions[transactionIndex + 1];
        const transactionPaymentType = useSparkPaymentType(currentTransaction);

        const isDonation = isSparkDonationPayment(
          currentTransaction,
          lastTransaction,
        );
        // const isLightningPayment = tx.type === 'PREIMAGE_SWAP';
        // const isBitcoinPayment = tx.type == 'COOPERATIVE_EXIT';
        // const isSparkPayment = tx.type === 'TRANSFER';

        // const isLiquidPayment = currentTransaction.usesLiquidNode;
        // const isLightningPayment = currentTransaction.usesLightningNode;
        // const isEcashPayment = currentTransaction.usesEcash;
        // const isFailedPayment =
        //   !(currentTransaction.status === 'complete') &&
        //   !!currentTransaction?.error;

        const paymentDate = new Date(
          currentTransaction.updated_at_time,
        ).getTime();
        // let paymentDate;
        // if (isLiquidPayment) {
        //   paymentDate = currentTransaction.timestamp * 1000;
        // } else if (isLightningPayment) {
        //   paymentDate = currentTransaction.paymentTime * 1000; // could also need to be timd by 1000
        // } else {
        //   paymentDate = currentTransaction.time;
        // }

        const uniuqeIDFromTx = currentTransaction.id;

        const styledTx = (
          <UserTransaction
            tx={currentTransaction}
            currentTime={currentTime}
            navigate={navigate}
            transactionPaymentType={transactionPaymentType}
            // isLightningPayment={isLightningPayment}
            // isBitcoinPayment={isBitcoinPayment}
            // isSparkPayment={isSparkPayment}
            paymentDate={paymentDate}
            id={uniuqeIDFromTx}
            frompage={frompage}
            theme={theme}
            darkModeType={darkModeType}
            userBalanceDenomination={userBalanceDenomination}
            isDonation={isDonation}

            // isLiquidPayment={isLiquidPayment}
            // isEcashPayment={isEcashPayment}
            // isFailedPayment={isFailedPayment}
            // isBankPage={isBankPage}
          />
        );

        const timeDifference =
          (currentTime - paymentDate) / 1000 / 60 / 60 / 24;

        const bannerText =
          timeDifference < 0.5
            ? todayText
            : timeDifference > 0.5 && timeDifference < 1
            ? yesterdayText
            : Math.round(timeDifference) <= 30
            ? `${Math.round(timeDifference)} ${
                Math.round(timeDifference) === 1 ? dayText : dayText + 's'
              } ${agoText}`
            : Math.round(timeDifference) > 30 &&
              Math.round(timeDifference) < 365
            ? `${Math.floor(Math.round(timeDifference) / 30)} ${monthText}${
                Math.floor(Math.round(timeDifference) / 30) === 1 ? '' : 's'
              } ${agoText}`
            : `${Math.floor(Math.round(timeDifference) / 365)} ${yearText}${
                Math.floor(Math.round(timeDifference) / 365) ? '' : 's'
              } ${agoText}`;

        if (
          (transactionIndex === 0 || currentGroupedDate != bannerText) &&
          timeDifference > 0.5 &&
          frompage != 'home'
        ) {
          currentGroupedDate = bannerText;
          formattedTxs.push(dateBanner(bannerText));
        }

        if (isDonation && frompage != 'viewAllTx') {
          didExcludeTxs = true;
          throw Error('Support transactions are not shown on homepage');
        }

        if (
          transactionPaymentType === 'lightning' &&
          currentTransaction.status === 'LIGHTNING_PAYMENT_INITIATED'
        )
          throw Error('Lightning invoice has not been paid yet, hiding...');

        formattedTxs.push(styledTx);
      } catch (err) {
        console.log(err);
      } finally {
        transactionIndex += 1;
      }
    }

    if (
      frompage != 'viewAllTx' &&
      formattedTxs?.length == homepageTxPreferance &&
      didExcludeTxs
    )
      formattedTxs.push(
        <TouchableOpacity
          key={'view_all_tx_btn'}
          style={{marginBottom: 10, ...CENTER}}
          onPress={() => {
            navigate.navigate('ViewAllTxPage');
          }}>
          <ThemeText content={viewAllTxText} styles={{...styles.headerText}} />
        </TouchableOpacity>,
      );

    return formattedTxs;
  }
}

export const UserTransaction = memo(function UserTransaction({
  tx: transaction,
  currentTime,
  paymentDate,
  transactionPaymentType,
  // isLightningPayment,
  // isBitcoinPayment,
  // isSparkPayment,
  id,
  navigate,
  frompage,
  theme,
  darkModeType,
  userBalanceDenomination,
  // isLiquidPayment,
  // isEcashPayment,
  // isFailedPayment,
  // isBankPage,
}) {
  const {t} = useTranslation();
  const endDate = currentTime;
  //   BITCOIN PENDING = TRANSFER_STATUS_SENDER_KEY_TWEAK_PENDING
  //   BITCOIN CONFIRMED = TRANSFER_STATUS_SENDER_KEY_TWEAKED

  //   SPARK PENDING = TRANSFER_STATUS_SENDER_KEY_TWEAKED
  //   SPARK CONFIRMED = TRANSFER_STATUS_COMPLETED

  //   LIGHTING PENDING = LIGHTNING_PAYMENT_INITIATED
  //   LIGHTNING CONFIRMED = TRANSFER_STATUS_COMPLETED

  const timeDifferenceMs = endDate - paymentDate;

  const timeDifference = useMemo(() => {
    const minutes = timeDifferenceMs / (1000 * 60);
    const hours = minutes / 60;
    const days = hours / 24;
    const years = days / 365;
    return {minutes, hours, days, years};
  }, [timeDifferenceMs]);

  const paymentImage = useMemo(() => {
    // I removed failed icons here for now

    return darkModeType && theme
      ? ICONS.arrow_small_left_white
      : ICONS.smallArrowLeft;

    // return darkModeType && theme
    //   ? ICONS.failedTransactionWhite
    //   : ICONS.failedTransaction;
  }, [
    transactionPaymentType,
    // isBitcoinPayment,
    // isLightningPayment,
    // isSparkPayment,
    transaction,
    darkModeType,
    theme,
  ]);

  // const paymentImage = useMemo(() => {
  //   if (
  //     isLiquidPayment ||
  //     transaction.status === 'complete' ||
  //     isEcashPayment
  //   ) {
  //     return darkModeType && theme
  //       ? ICONS.arrow_small_left_white
  //       : ICONS.smallArrowLeft;
  //   }
  //   return darkModeType && theme
  //     ? ICONS.failedTransactionWhite
  //     : ICONS.failedTransaction;
  // }, [
  //   isLiquidPayment,
  //   isEcashPayment,
  //   transaction.status,
  //   darkModeType,
  //   theme,
  // ]);
  const showPendingTransactionStatusIcon = useIsSparkPaymentPending(
    transaction,
    transactionPaymentType,
  );
  // const showPendingTransactionStatusIcon = useMemo(
  //   () =>
  //     (transactionPaymentType === 'bitcoin' &&
  //       transaction.status === 'TRANSFER_STATUS_SENDER_KEY_TWEAK_PENDING') ||
  //     (transactionPaymentType === 'spark' &&
  //       transaction.status === 'TRANSFER_STATUS_SENDER_KEY_TWEAKED') ||
  //     (transactionPaymentType === 'lightning' &&
  //       transaction.status === 'LIGHTNING_PAYMENT_INITIATED'),
  //   [
  //     transaction,
  //     //  isBitcoinPayment,
  //     // isSparkPayment,
  //     //  isLightningPayment,
  //     transactionPaymentType,
  //   ],
  // );

  const paymentDescription = isDonation
    ? BLITZ_SUPPORT_DEFAULT_PAYMENT_DESCRIPTION
    : transaction.description;
  const isDefaultDescription =
    paymentDescription === BLITZ_DEFAULT_PAYMENT_DESCRIPTION;

  return (
    <TouchableOpacity
      style={{
        width: frompage === 'viewAllTx' ? '90%' : '85%',
        ...CENTER,
      }}
      key={id}
      activeOpacity={0.5}
      onPress={() => {
        crashlyticsLogReport('Navigatin to expanded tx from user transaction');
        navigate.navigate('ExpandedTx', {isFailedPayment: {}, transaction});
      }}>
      <View style={styles.transactionContainer}>
        {showPendingTransactionStatusIcon ? (
          <View style={styles.icons}>
            <Icon
              width={27}
              height={27}
              color={
                darkModeType && theme ? COLORS.darkModeText : COLORS.primary
              }
              name={'pendingTxIcon'}
            />
          </View>
        ) : (
          <Image
            source={paymentImage}
            style={[
              styles.icons,
              {
                transform: [
                  {
                    rotate: showPendingTransactionStatusIcon
                      ? '0deg'
                      : transaction.transfer_direction === 'OUTGOING'
                      ? '310deg'
                      : '130deg',
                  },
                ],
              },
            ]}
            resizeMode="contain"
          />
        )}

        <View style={{flex: 1, width: '100%'}}>
          <ThemeText
            CustomEllipsizeMode="tail"
            CustomNumberOfLines={1}
            styles={styles.descriptionText}
            content={
              userBalanceDenomination === 'hidden'
                ? `${HIDDEN_BALANCE_TEXT}`
                : isDefaultDescription || !paymentDescription
                ? transaction.transfer_direction === 'OUTGOING'
                  ? t('constants.sent')
                  : t('constants.received')
                : paymentDescription
            }
          />

          <ThemeText
            styles={styles.dateText}
            content={`${
              timeDifference.minutes <= 1
                ? `Just now`
                : timeDifference.minutes <= 60
                ? Math.round(timeDifference.minutes) || ''
                : timeDifference.hours <= 24
                ? Math.round(timeDifference.hours)
                : timeDifference.days <= 365
                ? Math.round(timeDifference.days)
                : Math.round(timeDifference.years)
            } ${
              timeDifference.minutes <= 1
                ? ''
                : timeDifference.minutes <= 60
                ? t('constants.minute') +
                  (Math.round(timeDifference.minutes) === 1 ? '' : 's')
                : timeDifference.hours <= 24
                ? t('constants.hour') +
                  (Math.round(timeDifference.hours) === 1 ? '' : 's')
                : timeDifference.days <= 365
                ? t('constants.day') +
                  (Math.round(timeDifference.days) === 1 ? '' : 's')
                : Math.round(timeDifference.years) === 1
                ? 'year'
                : 'years'
            } ${
              timeDifference.minutes < 1 ? '' : t('transactionLabelText.ago')
            }`}
          />
        </View>

        <FormattedSatText
          containerStyles={{marginLeft: 'auto', marginBottom: 'auto'}}
          frontText={
            userBalanceDenomination !== 'hidden'
              ? transaction.transfer_direction === 'OUTGOING'
                ? '+'
                : '-'
              : ''
          }
          styles={styles.amountText}
          balance={transaction.total_sent}
        />
      </View>
    </TouchableOpacity>
  );
});

export function dateBanner(bannerText) {
  return (
    <View key={bannerText}>
      <ThemeText
        styles={{
          ...styles.transactionTimeBanner,
        }}
        content={`${bannerText}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  transactionContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12.5,
    ...CENTER,
  },
  icons: {
    width: 30,
    height: 30,
    marginRight: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  descriptionText: {
    fontWeight: 400,
    marginRight: 20,
  },
  dateText: {
    fontSize: SIZES.small,
    fontWeight: 300,
  },
  amountText: {
    fontWeight: 400,
  },
  transactionTimeBanner: {
    textAlign: 'center',
  },
  scrollContainer: {
    flex: 1,
    width: '85%',
    alignItems: 'center',
  },
  noTransactionsContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noTransactionsText: {
    width: '95%',
    maxWidth: 300,
    textAlign: 'center',
  },

  mostRecentTxContainer: {
    width: 'auto',
    ...CENTER,
    alignItems: 'center',
  },
});
