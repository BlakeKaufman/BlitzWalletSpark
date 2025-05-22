import React, {useCallback, useRef, useState} from 'react';
import {Platform, RefreshControl, View} from 'react-native';
import Animated from 'react-native-reanimated';
import {useCustomFlatListHook} from './useCustomFlatListHooks';
import {COLORS} from '../../../../../constants';
// import {sync as syncLiquid} from '@breeztech/react-native-breez-sdk-liquid';
import {useGlobalContextProvider} from '../../../../../../context-store/context';
import {useGlobalThemeContext} from '../../../../../../context-store/theme';
import {
  crashlyticsLogReport,
  crashlyticsRecordErrorReport,
} from '../../../../../functions/crashlyticsLogs';
import {useFocusEffect} from '@react-navigation/native';

function CustomFlatList({style, ...props}) {
  const {masterInfoObject} = useGlobalContextProvider();
  const {theme, darkModeType} = useGlobalThemeContext();
  const [refreshing, setRefreshing] = useState(false);
  const flatListRef = useRef(null);
  const [
    scrollHandler,
    styles,
    stickyElementStyle,
    topElementStyle,
    onLayoutHeaderElement,
    onLayoutTopListElement,
    onLayoutStickyElement,
  ] = useCustomFlatListHook();

  const handleRefresh = useCallback(async () => {
    crashlyticsLogReport(`Running in handle refresh function on homepage`);
    try {
      return;
      // setRefreshing(true);
      // await Promise.all([
      //   syncLiquid(),
      //   masterInfoObject.liquidWalletSettings.isLightningEnabled
      //     ? syncLightning()
      //     : Promise.resolve(true),
      // ]);
    } catch (err) {
      console.log('error refreshing', err);
      crashlyticsRecordErrorReport(err.message);
    } finally {
      setRefreshing(false);
    }
  }, [masterInfoObject]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'ios')
        flatListRef.current?.scrollToOffset({offset: 0});
      return () => {
        if (Platform.OS == 'android')
          flatListRef.current?.scrollToOffset({offset: 0});
      };
    }, []),
  );

  const colors = Platform.select({
    ios: darkModeType && theme ? COLORS.darkModeText : COLORS.primary,
    android: darkModeType && theme ? COLORS.lightModeText : COLORS.primary,
  });

  return (
    <View style={style}>
      <Animated.View
        style={[styles.stickyElement, stickyElementStyle]}
        onLayout={onLayoutStickyElement}>
        {props.StickyElementComponent}
      </Animated.View>

      <Animated.View
        style={[styles.topElement, topElementStyle]}
        onLayout={onLayoutTopListElement}>
        {props.TopListElementComponent}
      </Animated.View>

      <Animated.FlatList
        refreshControl={
          <RefreshControl
            colors={[colors]}
            tintColor={
              darkModeType && theme ? COLORS.darkModeText : COLORS.primary
            }
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        }
        ref={flatListRef}
        initialNumToRender={10}
        maxToRenderPerBatch={5}
        updateCellsBatchingPeriod={50}
        showsVerticalScrollIndicator={false}
        {...props}
        ListHeaderComponent={
          <Animated.View onLayout={onLayoutHeaderElement}>
            {props.HeaderComponent}
          </Animated.View>
        }
        ListHeaderComponentStyle={[
          props.ListHeaderComponentStyle,
          styles.header,
        ]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      />
    </View>
  );
}

export default CustomFlatList;
