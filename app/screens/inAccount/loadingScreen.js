import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {COLORS, ICONS} from '../../constants';
import {useGlobalContextProvider} from '../../../context-store/context';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import initializeUserSettingsFromHistory from '../../functions/initializeUserSettings';
import claimUnclaimedBoltzSwaps from '../../functions/boltz/claimUnclaimedTxs';
import {useGlobalContacts} from '../../../context-store/globalContacts';
import {
  getDateXDaysAgo,
  isMoreThan7DaysPast,
} from '../../functions/rotateAddressDateChecker';
import {useGlobaleCash} from '../../../context-store/eCash';
import {useGlobalAppData} from '../../../context-store/appData';
import {GlobalThemeView, ThemeText} from '../../functions/CustomElements';
import LottieView from 'lottie-react-native';
import {useNavigation} from '@react-navigation/native';
import ThemeImage from '../../functions/CustomElements/themeImage';
import {
  fetchFiatRates,
  getInfo,
  listFiatCurrencies,
  listPayments,
} from '@breeztech/react-native-breez-sdk-liquid';
import connectToLiquidNode from '../../functions/connectToLiquid';
import {breezLiquidReceivePaymentWrapper} from '../../functions/breezLiquid';
import {initializeDatabase} from '../../functions/messaging/cachedMessages';
import {useLiquidEvent} from '../../../context-store/liquidEventContext';
import {useGlobalThemeContext} from '../../../context-store/theme';
import {useNodeContext} from '../../../context-store/nodeContext';
import {useKeysContext} from '../../../context-store/keys';
import {initEcashDBTables} from '../../functions/eCash/db';
import {initializePOSTransactionsDatabase} from '../../functions/pos';
import {updateMascatWalkingAnimation} from '../../functions/lottieViewColorTransformer';
import {crashlyticsLogReport} from '../../functions/crashlyticsLogs';
import {
  getCachedSparkTransactions,
  getSparkAddress,
  getSparkBalance,
  initializeSparkWallet,
} from '../../functions/spark';
import {useSparkWallet} from '../../../context-store/sparkContext';
import {initializeSparkDatabase} from '../../functions/spark/transactions';
const mascotAnimation = require('../../assets/MOSCATWALKING.json');

export default function ConnectingToNodeLoadingScreen({
  navigation: {replace},
  route,
}) {
  const navigate = useNavigation();
  const {onLiquidBreezEvent} = useLiquidEvent();
  const {toggleMasterInfoObject, masterInfoObject, setMasterInfoObject} =
    useGlobalContextProvider();
  const {setSparkInformation} = useSparkWallet();
  const {toggleContactsPrivateKey} = useKeysContext();
  const {toggleLiquidNodeInformation, toggleFiatStats} = useNodeContext();
  const {theme, darkModeType} = useGlobalThemeContext();
  const {toggleGlobalContactsInformation, globalContactsInformation} =
    useGlobalContacts();
  const {toggleGLobalEcashInformation} = useGlobaleCash();
  const {toggleGlobalAppDataInformation} = useGlobalAppData();
  const [hasError, setHasError] = useState(null);
  const {t} = useTranslation();

  //gets data from either firebase or local storage to load users saved settings
  const didLoadInformation = useRef(false);
  const didOpenDatabases = useRef(false);
  const didRestoreWallet = route?.params?.didRestoreWallet;

  const transformedAnimation = useMemo(() => {
    return updateMascatWalkingAnimation(
      mascotAnimation,
      theme ? 'white' : 'blue',
    );
  }, [theme]);

  const [message, setMessage] = useState(t('loadingScreen.message1'));

  useEffect(() => {
    const intervalId = setInterval(() => {
      setMessage(prevMessage =>
        prevMessage === t('loadingScreen.message1')
          ? t('loadingScreen.message2')
          : t('loadingScreen.message1'),
      );
    }, 5000);

    // Clean up the interval on component unmount
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    async function startConnectProcess() {
      try {
        crashlyticsLogReport(
          'Begining app connnection procress in loading screen',
        );
        const [didOpen, ecashTablesOpened, posTransactions, sparkTxs] =
          await Promise.all([
            initializeDatabase(),
            initEcashDBTables(),
            initializePOSTransactionsDatabase(),
            initializeSparkDatabase(),
          ]);
        if (!didOpen || !ecashTablesOpened || !posTransactions || !sparkTxs)
          throw new Error('Database initialization failed');
        crashlyticsLogReport('Opened all SQL lite tables');
        const didLoadUserSettings = await initializeUserSettingsFromHistory({
          setContactsPrivateKey: toggleContactsPrivateKey,
          setMasterInfoObject,
          toggleGlobalContactsInformation,
          toggleGLobalEcashInformation,
          toggleGlobalAppDataInformation,
        });
        if (!didLoadUserSettings)
          throw new Error('Failed to load user settings');
        crashlyticsLogReport('Loaded users settings from firebase');
        claimUnclaimedBoltzSwaps();
        didOpenDatabases.current = true;
      } catch (err) {
        console.log('intializatiion error', err);
        setHasError(err.message);
      }
    }
    startConnectProcess();
  }, []);

  useEffect(() => {
    if (
      Object.keys(masterInfoObject).length === 0 ||
      didLoadInformation.current ||
      Object.keys(globalContactsInformation).length === 0 ||
      !didOpenDatabases.current
    )
      return;
    didLoadInformation.current = true;
    crashlyticsLogReport('Initializing wallet settings');

    initWallet();
  }, [masterInfoObject, globalContactsInformation]);

  return (
    <GlobalThemeView useStandardWidth={true}>
      <View style={styles.globalContainer}>
        {hasError && (
          <TouchableOpacity
            onPress={() =>
              navigate.navigate('SettingsHome', {isDoomsday: true})
            }
            style={styles.doomsday}>
            <ThemeImage
              lightModeIcon={ICONS.settingsIcon}
              darkModeIcon={ICONS.settingsIcon}
              lightsOutIcon={ICONS.settingsWhite}
            />
          </TouchableOpacity>
        )}
        <LottieView
          source={transformedAnimation}
          autoPlay
          loop={true}
          style={{
            width: 150, // adjust as necessary
            height: 150, // adjust as necessary
          }}
        />

        <ThemeText
          styles={{
            ...styles.waitingText,
            color: theme ? COLORS.darkModeText : COLORS.primary,
          }}
          content={hasError ? hasError : message}
        />
      </View>
    </GlobalThemeView>
  );

  async function initWallet() {
    console.log('HOME RENDER BREEZ EVENT FIRST LOAD');

    try {
      crashlyticsLogReport('Trying to connect to nodes');
      const [didConnectToLiquidNode, didConnectToSpark] = await Promise.all([
        connectToLiquidNode(onLiquidBreezEvent),
        initializeSparkWallet(), // Connect to spark node here
      ]);

      // We only care about the spark connection here. If liquid fails, continue since its not the main node
      if (didConnectToSpark.isConnected) {
        crashlyticsLogReport('Loading node balances for session');
        const [didSetLiquid, didSetSpark] = await Promise.all([
          setLiquidNodeInformationForSession(
            didConnectToLiquidNode?.liquid_node_info,
          ),
          initializeSparkSession(), // need to write function
        ]);

        // Same thing for here, if liquid does not set continue on in the process
        if (didSetSpark) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              replace('HomeAdmin', {screen: 'Home'});
            });
          });
        } else
          throw new Error(
            'Spark wallet information was not set properly, please try again.',
          );
      } else {
        throw new Error('We were unable to connect to the spark node.');
      }
    } catch (err) {
      setHasError(String(err.message));
      crashlyticsLogReport(err.message);
      console.log(err, 'homepage connection to node err');
    }
  }

  async function setupFiatCurrencies() {
    const fiat = await fetchFiatRates();
    const currency = masterInfoObject.fiatCurrency;

    const [fiatRate] = fiat.filter(rate => {
      return rate.coin.toLowerCase() === currency.toLowerCase();
    });
    if (masterInfoObject?.fiatCurrenciesList?.length < 1) {
      const currenies = await listFiatCurrencies();
      const sourted = currenies.sort((a, b) => a.id.localeCompare(b.id));
      toggleMasterInfoObject({fiatCurrenciesList: sourted});
    }

    return fiatRate;
  }

  async function setLiquidNodeInformationForSession(retrivedLiquidNodeInfo) {
    try {
      crashlyticsLogReport('Starting liquid node lookup process');
      const [parsedInformation, payments, fiat_rate, addressResponse] =
        await Promise.all([
          retrivedLiquidNodeInfo
            ? Promise.resolve(retrivedLiquidNodeInfo)
            : getInfo(),
          listPayments({}),
          setupFiatCurrencies(),
          masterInfoObject.offlineReceiveAddresses.addresses.length !== 7 ||
          isMoreThan7DaysPast(
            masterInfoObject.offlineReceiveAddresses.lastRotated,
          )
            ? breezLiquidReceivePaymentWrapper({
                paymentType: 'liquid',
              })
            : Promise.resolve(null),
        ]);

      const info = parsedInformation.walletInfo;
      const balanceSat = info.balanceSat;

      if (addressResponse) {
        const {destination, receiveFeesSat} = addressResponse;
        console.log('LIQUID DESTINATION ADDRESS', destination);
        console.log(destination);
        if (!globalContactsInformation.myProfile.receiveAddress) {
          // For legacy users and legacy functions
          toggleGlobalContactsInformation(
            {
              myProfile: {
                ...globalContactsInformation.myProfile,
                receiveAddress: destination,
                lastRotated: getDateXDaysAgo(0),
              },
            },
            true,
          );
        }
        // Didn't sperate since it only cost one write so there is no reasy not to update
        toggleMasterInfoObject({
          posSettings: {
            ...masterInfoObject.posSettings,
            receiveAddress: destination,
            lastRotated: getDateXDaysAgo(0),
          },
          offlineReceiveAddresses: {
            addresses: [
              destination,
              ...masterInfoObject.offlineReceiveAddresses.addresses.slice(0, 6),
            ],
            lastRotated: new Date().getTime(),
          },
        });
      }

      let liquidNodeObject = {
        transactions: payments,
        userBalance: balanceSat,
        pendingReceive: info.pendingReceiveSat,
        pendingSend: info.pendingSendSat,
      };

      toggleFiatStats({fiatStats: fiat_rate});

      console.log(
        didRestoreWallet,
        payments.length,
        !payments.length,
        'CHEKCING RETRY LOGIC',
      );

      if (didRestoreWallet) {
        console.log('RETRYING LIQUID INFORMATION, LOADING....');
        await new Promise(resolve => setTimeout(resolve, 10000));
        console.log('FINISHED WAITING');

        const [restoreWalletInfo, restoreWalletPayments] = await Promise.all([
          getInfo(),
          listPayments({}),
        ]);

        const restoreWalletBalance = restoreWalletInfo.walletInfo.balanceSat;

        console.log(
          restoreWalletInfo.walletInfo.balanceSat,
          restoreWalletPayments.length,
          'RETRY INFO',
        );

        liquidNodeObject = {
          transactions: restoreWalletPayments,
          userBalance: restoreWalletBalance,
          pendingReceive: restoreWalletInfo.walletInfo.pendingReceiveSat,
          pendingSend: restoreWalletInfo.walletInfo.pendingSendSat,
        };
      }

      toggleLiquidNodeInformation({
        ...liquidNodeObject,
        didConnectToNode: true,
      });

      return liquidNodeObject;
    } catch (err) {
      console.log(err, 'LIQUID INFORMATION ERROR');
      return new Promise(resolve => {
        resolve(false);
      });
    }
  }
  async function initializeSparkSession() {
    try {
      const [balance, transactions, sparkAddress] = await Promise.all([
        getSparkBalance(),
        getCachedSparkTransactions(),
        masterInfoObject.sparkAddress
          ? Promise.resolve(null)
          : getSparkAddress(),
      ]);

      if (balance === undefined || transactions === undefined)
        throw new Error('Unable to initialize spark from history');

      if (sparkAddress) {
        toggleMasterInfoObject({
          sparkAddress: sparkAddress,
        });
      }
      const storageObject = {
        balance: balance.balance,
        transactions: transactions,
        didConnect: true,
      };
      setSparkInformation(storageObject);
      return storageObject;
    } catch (err) {
      console.log('Set spark error', err);
      return false;
    }
  }
}

const styles = StyleSheet.create({
  globalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingText: {
    width: 300,
    marginTop: 10,
    textAlign: 'center',
    color: COLORS.primary,
  },
  doomsday: {
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
