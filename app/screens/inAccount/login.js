import {useEffect} from 'react';
import PinPage from '../../components/admin/loginComponents/pinPage';
import {GlobalThemeView} from '../../functions/CustomElements';
import {useLiquidEvent} from '../../../context-store/liquidEventContext';
import connectToLiquidNode from '../../functions/connectToLiquid';

export default function AdminLogin() {
  const {onLiquidBreezEvent} = useLiquidEvent();

  useEffect(() => {
    connectToLiquidNode(onLiquidBreezEvent);
  }, []);

  return (
    <GlobalThemeView useStandardWidth={true}>
      <PinPage />
    </GlobalThemeView>
  );
}
