import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {COLORS, SIZES} from '../../../../constants';
import {useGlobalContextProvider} from '../../../../../context-store/context';
import FormattedSatText from '../../../../functions/CustomElements/satTextDisplay';
import {memo, useCallback, useEffect, useRef, useState} from 'react';
import handleDBStateChange from '../../../../functions/handleDBStateChange';
import Icon from '../../../../functions/CustomElements/Icon';
import {useNavigation} from '@react-navigation/native';
import {crashlyticsLogReport} from '../../../../functions/crashlyticsLogs';
import {useSparkWallet} from '../../../../../context-store/sparkContext';
import {ThemeText} from '../../../../functions/CustomElements';

export const UserSatAmount = memo(function UserSatAmount({
  isConnectedToTheInternet,
  theme,
  darkModeType,
}) {
  const {sparkInformation, numberOfIncomingLNURLPayments} = useSparkWallet();
  const didMount = useRef(null);

  const {masterInfoObject, toggleMasterInfoObject, setMasterInfoObject} =
    useGlobalContextProvider();

  const saveTimeoutRef = useRef(null);
  const navigate = useNavigation();
  const [balanceWidth, setBalanceWidth] = useState(0);
  const userBalance = sparkInformation.balance;

  useEffect(() => {
    didMount.current = true;
    return () => (didMount.current = false);
  }, []);

  const handleLayout = useCallback(
    event => {
      const {width} = event.nativeEvent.layout;
      if (!didMount.current) return;
      setBalanceWidth(width);
    },
    [didMount],
  );

  return (
    <TouchableOpacity
      onLayout={handleLayout}
      style={styles.balanceContainer}
      onPress={() => {
        if (!isConnectedToTheInternet) {
          navigate.navigate('ErrorScreen', {
            errorMessage:
              'Please reconnect to the internet to switch your denomination',
          });
          return;
        }
        if (masterInfoObject.userBalanceDenomination === 'sats')
          handleDBStateChange(
            {userBalanceDenomination: 'fiat'},
            setMasterInfoObject,
            toggleMasterInfoObject,
            saveTimeoutRef,
          );
        else if (masterInfoObject.userBalanceDenomination === 'fiat')
          handleDBStateChange(
            {userBalanceDenomination: 'hidden'},
            setMasterInfoObject,
            toggleMasterInfoObject,
            saveTimeoutRef,
          );
        else
          handleDBStateChange(
            {userBalanceDenomination: 'sats'},
            setMasterInfoObject,
            toggleMasterInfoObject,
            saveTimeoutRef,
          );
      }}>
      <View style={styles.valueContainer}>
        <FormattedSatText styles={styles.valueText} balance={userBalance} />
      </View>
      {!!numberOfIncomingLNURLPayments && (
        <TouchableOpacity
          onPress={() => {
            crashlyticsLogReport(
              'Navigating to information popup page from user sat amount',
            );
            navigate.navigate('InformationPopup', {
              CustomTextComponent: () => {
                return (
                  <ThemeText
                    styles={styles.informationText}
                    content={`You have ${numberOfIncomingLNURLPayments} lightning address payment${
                      numberOfIncomingLNURLPayments > 1 ? 's' : ''
                    } waiting to confirm.`}
                  />
                );
              },
              buttonText: 'I understand',
            });
          }}
          style={{...styles.pendingBalanceChange, left: balanceWidth + 5}}>
          <Icon
            color={darkModeType && theme ? COLORS.darkModeText : COLORS.primary}
            width={25}
            height={25}
            name={'pendingTxIcon'}
          />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  balanceContainer: {
    justifyContent: 'center',
    marginBottom: 5,
    position: 'relative',
  },
  valueContainer: {
    width: '95%',
    maxWidth: 280,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  informationPopupContainer: {
    width: '100%',
    marginBottom: 30,
    flexWrap: 'wrap',
  },
  pendingBalanceChange: {position: 'absolute'},

  informationText: {marginBottom: 20, textAlign: 'center'},

  valueText: {
    fontSize: SIZES.xxLarge,
    includeFontPadding: false,
  },
});
