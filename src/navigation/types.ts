import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {CompositeScreenProps} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {SalesPeriod} from '@/utils/date';

/**
 * `mode` decides what the Scanner does with a hit:
 *  - 'lookup'  : the primary sell flow — find the product and open it.
 *  - 'request' : a caller is awaiting BarcodeScannerService.scanFromCamera().
 *  - 'assign'  : capturing a barcode for a product form, returned via callback.
 */
export type ScannerMode = 'lookup' | 'request' | 'assign';

export type RootStackParamList = {
  Tabs: undefined;
  Scanner: {mode: ScannerMode} | undefined;
  /** Reached when a scan matches nothing — offers "Add this product". */
  ScanResult: {barcode: string; productId: string | null};
  ProductDetail: {productId: string};
  ProductForm: {productId?: string; barcode?: string};
  /** The image pipeline screen: pick a photo, run the ladder, crop, or type it in. */
  ImageBarcode: {returnTo: 'ProductForm'; productId?: string} | undefined;
  Sell: {productId: string};
  AddStock: {productId: string};
  StockAdjust: {productId: string};
  SaleDetail: {saleId: string};
  InventoryHistory: {productId?: string} | undefined;
  ProductImages: {productId: string};
  Settings: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Products: {focusSearch?: boolean} | undefined;
  Sales: {period?: SalesPeriod} | undefined;
  More: undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

/**
 * Tab screens sit inside the root stack, so they need to reach both param
 * lists — e.g. the dashboard opens ProductDetail (stack) and the Products tab.
 */
export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
