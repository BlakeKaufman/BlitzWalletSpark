import React, {createContext, useEffect, useRef, useState} from 'react';
import WebView from 'react-native-webview';
import {AppState, Platform} from 'react-native';
import {getLocalStorageItem, setLocalStorageItem} from '../app/functions';
import {isMoreThanADayOld} from '../app/functions/rotateAddressDateChecker';
import {useAppStatus} from './appStatus';
import {BOLTZ_SAVED_CLAIM_TXS_KEY} from '../app/constants';
import {getClaimReverseSubmarineSwapJS} from '../app/functions/boltz/handle-reverse-claim-wss';
import handleWebviewClaimMessage from '../app/functions/boltz/handle-webview-claim-message';

// Create a context for the WebView ref
const WebViewContext = createContext(null);

export const WebViewProvider = ({children}) => {
  const {didGetToHomepage} = useAppStatus();
  const webViewRef = useRef(null);
  const [isWEbViewReady, setIsWebViewReady] = useState(false);
  // const [webViewArgs, setWebViewArgs] = useState({
  //   navigate: null,
  //   page: null,
  //   function: null,
  // });

  useEffect(() => {
    if (!didGetToHomepage) {
      return;
    }
    async function handleUnclaimedReverseSwaps() {
      let savedClaimInfo =
        JSON.parse(await getLocalStorageItem('savedReverseSwapInfo')) || [];
      console.log(savedClaimInfo, 'SAVD CLAIM INFORMATION');
      if (savedClaimInfo.length === 0) return;

      try {
        savedClaimInfo.forEach(claim => {
          const claimInfo = JSON.stringify(claim);
          webViewRef.current.injectJavaScript(
            `window.claimReverseSubmarineSwap(${claimInfo}); void(0);`,
          );
        });

        setLocalStorageItem(
          'savedReverseSwapInfo',
          JSON.stringify(
            savedClaimInfo.filter(item => !isMoreThanADayOld(item.createdOn)),
          ),
        );
      } catch (error) {
        console.error('An error occurred:', error);
      }
    }
    handleUnclaimedReverseSwaps();
  }, [didGetToHomepage]);

  useEffect(() => {
    const handleRetry = async () => {
      console.log('Running retry for Boltz claims');
      const savedFailedClaims =
        JSON.parse(await getLocalStorageItem(BOLTZ_SAVED_CLAIM_TXS_KEY)) || [];
      if (savedFailedClaims.length === 0) return;
      let mutatedArray = [];
      for (const claim of savedFailedClaims) {
        if (claim.runcount >= 20) continue;
        console.log(claim, 'RETRYING CLAIM', webViewRef);

        getClaimReverseSubmarineSwapJS({
          webViewRef,
          address: claim.liquidAddress,
          swapInfo: claim.swapInfo,
          preimage: claim.preimage,
          privateKey: claim.privateKey,
        });
        mutatedArray = savedFailedClaims.map(savedClaim => {
          if (savedClaim.swapInfo.id === claim.swapInfo.id) {
            return {...claim, runcount: (claim?.runcount || 0) + 1};
          } else return savedClaim;
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      setLocalStorageItem(
        BOLTZ_SAVED_CLAIM_TXS_KEY,
        JSON.stringify(mutatedArray),
      );
    };

    if (!isWEbViewReady) return;
    console.log('Setting up retry interval for Boltz claims');
    setInterval(handleRetry, 30000);
  }, [isWEbViewReady]);

  return (
    <WebViewContext.Provider
      value={{
        webViewRef,
        // webViewArgs,
        // setWebViewArgs,
      }}>
      {children}
      <WebView
        domStorageEnabled
        javaScriptEnabled
        ref={webViewRef}
        containerStyle={{position: 'absolute', top: 1000, left: 1000}}
        source={
          Platform.OS === 'ios'
            ? require('boltz-swap-web-context')
            : {uri: 'file:///android_asset/boltzSwap.html'}
        }
        originWhitelist={['*']}
        onMessage={event =>
          handleWebviewClaimMessage(
            // webViewArgs.navigate,
            event,
            // webViewArgs.page,
            // webViewArgs.function,
          )
        }
        onLoadEnd={() => setIsWebViewReady(true)}
      />
    </WebViewContext.Provider>
  );
};

export const useWebView = () => {
  return React.useContext(WebViewContext);
};
