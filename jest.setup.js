/* eslint-env jest */
/**
 * Native modules have no JS-side implementation under Jest. Every module mocked
 * here is stubbed only so imports resolve; tests that care about behaviour
 * (repositories, inventory maths, Excel/backup payload building) run against the
 * real code paths using the node:sqlite driver and an in-memory filesystem.
 */

/**
 * Run the suite in the timezone the app is built for. Timestamps are stored as
 * UTC but sale numbers, date ranges and day grouping are local, so a UTC test
 * machine would silently hide every off-by-one-day bug.
 */
process.env.TZ = 'Asia/Kolkata';

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(),
  moveAssetsDatabase: jest.fn(),
}));

jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraDevice: jest.fn(() => undefined),
  useCameraPermission: jest.fn(() => ({hasPermission: true, requestPermission: jest.fn()})),
  useCodeScanner: jest.fn(() => ({})),
}));

jest.mock('@react-native-ml-kit/barcode-scanning', () => ({
  __esModule: true,
  default: {scan: jest.fn(async () => [])},
}));

jest.mock('react-native-image-crop-picker', () => ({
  openCamera: jest.fn(),
  openPicker: jest.fn(),
  openCropper: jest.fn(),
  clean: jest.fn(),
}));

jest.mock('@bam.tech/react-native-image-resizer', () => ({
  __esModule: true,
  default: {createResizedImage: jest.fn()},
}));

jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {open: jest.fn()},
  Social: {},
}));

jest.mock('react-native-zip-archive', () => ({
  zip: jest.fn(),
  unzip: jest.fn(),
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {zip: 'application/zip', allFiles: '*/*'},
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/documents',
  CachesDirectoryPath: '/tmp/caches',
  mkdir: jest.fn(),
  exists: jest.fn(),
  unlink: jest.fn(),
  copyFile: jest.fn(),
  moveFile: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
  readDir: jest.fn(),
  stat: jest.fn(),
  uploadFiles: jest.fn(),
  downloadFile: jest.fn(),
}));

jest.mock('react-native-screens', () => ({enableScreens: jest.fn()}));
