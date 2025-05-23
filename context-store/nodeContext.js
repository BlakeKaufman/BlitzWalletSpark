import {
  createContext,
  useState,
  useContext,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import {useAppStatus} from './appStatus';
import {calculateBoltzFeeNew} from '../app/functions/boltz/boltzFeeNew';
import {sparkReceivePaymentWrapper} from '../app/functions/spark/payments';
import {breezLiquidPaymentWrapper} from '../app/functions/breezLiquid';

// Initiate context
const NodeContextManager = createContext(null);

const GLobalNodeContextProider = ({children}) => {
  const {didGetToHomepage, minMaxLiquidSwapAmounts} = useAppStatus();
  const [nodeInformation, setNodeInformation] = useState({
    didConnectToNode: null,
    transactions: [],
    userBalance: 0,
    inboundLiquidityMsat: 0,
    blockHeight: 0,
    onChainBalance: 0,
    fiatStats: {},
    lsp: [],
  });
  const [liquidNodeInformation, setLiquidNodeInformation] = useState({
    didConnectToNode: null,
    transactions: [],
    userBalance: 0,
  });
  const [fiatStats, setFiatStats] = useState({});
  const toggleFiatStats = useCallback(newInfo => {
    setFiatStats(prev => ({...prev, ...newInfo}));
  }, []);

  const toggleLiquidNodeInformation = useCallback(newInfo => {
    setLiquidNodeInformation(prev => ({...prev, ...newInfo}));
  }, []);

  useEffect(() => {
    if (!didGetToHomepage) return;
    async function swapLiquidToSpark() {
      if (liquidNodeInformation.userBalance > 500) {
        const liquidFee = calculateBoltzFeeNew(
          liquidNodeInformation.userBalance,
          'liquid-ln',
          minMaxLiquidSwapAmounts.submarineSwapStats,
        );
        const feeBuffer = liquidFee * 3.5;

        const sendAmount = Math.round(
          liquidNodeInformation.userBalance - feeBuffer,
        );

        if (sendAmount < minMaxLiquidSwapAmounts.min) return;
        console.log(liquidFee, 'liquid fee');
        console.log(sendAmount, 'send amount');
        console.log(liquidNodeInformation.userBalance, 'user balance');

        const sparkLnReceiveAddress = await sparkReceivePaymentWrapper({
          amountSats: sendAmount,
          memo: 'Liquid to Spark Swap',
          paymentType: 'lightning',
        });

        if (!sparkLnReceiveAddress.didWork) return;

        await breezLiquidPaymentWrapper({
          paymentType: 'lightning',
          sendAmount: sendAmount,
          invoice: sparkLnReceiveAddress.invoice,
        });
      }
    }
    swapLiquidToSpark();
  }, [didGetToHomepage, liquidNodeInformation, minMaxLiquidSwapAmounts]);

  const contextValue = useMemo(
    () => ({
      nodeInformation,
      liquidNodeInformation,
      toggleLiquidNodeInformation,
      toggleFiatStats,
      fiatStats,
    }),
    [
      nodeInformation,
      liquidNodeInformation,
      fiatStats,
      toggleFiatStats,
      toggleLiquidNodeInformation,
    ],
  );

  return (
    <NodeContextManager.Provider value={contextValue}>
      {children}
    </NodeContextManager.Provider>
  );
};

function useNodeContext() {
  const context = useContext(NodeContextManager);
  if (!context) {
    throw new Error(
      'useNodeContext must be used within a GLobalNodeContextProider',
    );
  }
  return context;
}

export {NodeContextManager, GLobalNodeContextProider, useNodeContext};
