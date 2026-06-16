/** Approximate WGS84 bboxes [south, west, north, east] for Overpass province queries. */
export const PROVINCE_BBOXES = {
  AB: [49.0, -120.0, 60.0, -110.0],
  BC: [48.3, -139.0, 60.0, -114.0],
  MB: [49.0, -102.0, 60.0, -88.5],
  NB: [44.5, -69.0, 48.0, -63.5],
  NL: [46.0, -67.0, 60.5, -52.0],
  NS: [43.5, -66.5, 47.0, -59.5],
  NT: [60.0, -136.0, 78.0, -102.0],
  NU: [51.0, -120.0, 84.0, -61.0],
  ON: [41.5, -95.5, 57.0, -74.0],
  PE: [45.9, -64.5, 47.1, -61.8],
  QC: [45.0, -80.0, 63.0, -57.0],
  SK: [49.0, -110.5, 60.5, -101.0],
  YT: [60.0, -141.0, 69.5, -128.0],
};

export const CA_PROVINCES = Object.keys(PROVINCE_BBOXES);
