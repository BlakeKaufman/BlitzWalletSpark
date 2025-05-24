import {
  SafeAreaView,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {CENTER, COLORS, FONT, SIZES} from '../constants';
import {useState} from 'react';
import {
  ReactNativeSparkSigner,
  SparkWallet,
} from '@buildonspark/spark-sdk/native';

export default function SparkDebug() {
  const [wallet, setWallet] = useState(null);
  const [lnInvoice, setLnInvoice] = useState('');
  const [sparkAddress, setSparkAddress] = useState('');
  const [balance, setBalance] = useState(0);
  // SDK events listener

  const initializeSparkWallet = async () => {
    try {
      console.log('Begining spark initialization');
      const mnemoinc =
        'best sibling prison engine shy lab describe exotic joy gas during simple';

      const [type, value] = await Promise.race([
        SparkWallet.initialize({
          signer: new ReactNativeSparkSigner(),
          mnemonicOrSeed: mnemoinc,
          options: {network: 'MAINNET'},
        }).then(res => ['wallet', res]),
        new Promise(res => setTimeout(() => res(['timeout', false]), 15000)),
      ]);

      if (type === 'wallet') {
        const {wallet} = value;

        console.log('Wallet initialized:', await wallet.getIdentityPublicKey());
        setWallet(wallet);
      } else if (type === 'timeout') {
        throw new Error('Unable to connect before timeout');
      }
    } catch (err) {
      console.log('Initialize spark wallet error', err);
    }
  };

  const getSparkBalance = async () => {
    try {
      if (!wallet) throw new Error('sparkWallet not initialized');
      const balance = await wallet.getBalance();
      if (balance) setBalance(balance.balance);
    } catch (err) {
      console.log('Get spark balance error', err);
    }
  };

  const getLightningInvoice = async () => {
    try {
      if (!wallet) throw new Error('Wallet not initialized');
      const invoice = await wallet.createLightningInvoice({
        amountSats: 1000,
        memo: 'Testing',
      });
      setLnInvoice(invoice);
    } catch (err) {
      console.log('Initialize spark wallet error', err);
    }
  };
  const getSparkAddress = async () => {
    try {
      if (!wallet) throw new Error('Wallet not initialized');
      const invoice = await wallet.getSparkAddress();
      setSparkAddress(invoice);
    } catch (err) {
      console.log('Initialize spark wallet error', err);
    }
  };

  const sendLightningPayment = async () => {
    try {
      if (!wallet) throw new Error('sparkWallet not initialized');
      return await wallet.payLightningInvoice({invoice: ''});
    } catch (err) {
      console.log('Send lightning payment error', err);
    }
  };
  const sendSparkPayment = async () => {
    try {
      if (!wallet) throw new Error('sparkWallet not initialized');
      return await wallet.transfer({receiverSparkAddress: '', amountSats: 100});
    } catch (err) {
      console.log('Send spark payment error', err);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Spark Wallet Debug</Text>
      <ScrollView contentContainerStyle={styles.innerContainer}>
        <Text style={styles.itemTitle}>{`Spark wall is${
          wallet ? '' : ' not'
        } initialized.`}</Text>
        <CustomButton
          actionFunction={initializeSparkWallet}
          title={'Initialize Spark Wallet'}
        />
        <Text style={styles.itemTitle}>{`Spark Balance:${Number(
          balance,
        )}`}</Text>
        <CustomButton
          actionFunction={getSparkBalance}
          title={'Get spark balance'}
        />

        <Text style={styles.itemTitle}>{`Get Lightning Invoice`}</Text>
        <Text style={styles.item}>
          {!lnInvoice ? 'No invoice set' : lnInvoice}
        </Text>
        <CustomButton
          actionFunction={getLightningInvoice}
          title={'Create invoice'}
        />
        <Text style={styles.itemTitle}>{`Get Spark Address`}</Text>
        <Text style={styles.item}>
          {!sparkAddress ? 'No spark address set' : sparkAddress}
        </Text>
        <CustomButton actionFunction={getSparkAddress} title={'Get address'} />
        <Text style={styles.itemTitle}>{`Send Lightning Payment`}</Text>
        <Text style={styles.item}>
          **Make sure to add invoice in function above**
        </Text>
        <CustomButton
          actionFunction={sendLightningPayment}
          title={'Send LN payment'}
        />
        <Text style={styles.itemTitle}>{`Send Spark Payment`}</Text>
        <Text style={styles.item}>
          **Make sure to add address and amount in function above**
        </Text>
        <CustomButton
          actionFunction={sendSparkPayment}
          title={'Send Spark payment'}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function CustomButton({title, actionFunction}) {
  return (
    <TouchableOpacity onPress={actionFunction} style={styles.buttonContainer}>
      <Text style={styles.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.lightModeBackground,
    flex: 1,
  },
  innerContainer: {
    width: '95%',
    flex: 1,
    alignSelf: 'center',
  },
  title: {
    fontSize: SIZES.xLarge,
    fontFamily: FONT.Title_Regular,
    textAlign: 'center',
  },
  itemTitle: {
    marginTop: 20,
    fontFamily: FONT.Title_Regular,
    textAlign: 'center',
    marginBottom: 10,
  },
  item: {
    fontFamily: FONT.Title_Regular,
    textAlign: 'center',
    marginBottom: 10,
  },
  buttonContainer: {
    padding: 10,
    ...CENTER,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  buttonText: {
    color: COLORS.darkModeText,
    fontFamily: FONT.Title_Regular,
  },
});
