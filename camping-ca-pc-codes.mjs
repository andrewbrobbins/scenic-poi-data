/** @param {string} url Parks Canada URL_e / site code */
export function pcCampgroundCodeFromUrl(url) {
  const raw = (url || "").trim().toUpperCase();
  if (!raw) return "";
  const parts = raw.split("-").filter(Boolean);
  if (parts.length < 2) return raw;

  const park = parts[0];
  if (!/^[A-Z]{2,5}$/.test(park)) return raw;

  if (parts.length === 2) {
    const cg = parts[1];
    const base = cg.replace(/\d+$/i, "");
    if (base && base !== cg && /^[A-Z]{2,5}$/i.test(base)) {
      return `${parts[0]}-${base}`;
    }
    return parts.join("-");
  }

  const last = parts[parts.length - 1];
  if (isPitchSuffix(last, parts.length)) {
    return parts.slice(0, -1).join("-");
  }
  return raw;
}

function isPitchSuffix(segment, partCount) {
  if (partCount < 3) return false;
  if (/^C\d+$/i.test(segment)) return true;
  if (/^[A-Z]{1,2}\d{0,3}$/i.test(segment) && /\d/.test(segment) === false) return false;
  if (/^[A-Z]{1,2}\d+$/i.test(segment)) return true;
  if (/^[A-Z0-9]{1,5}$/i.test(segment) && /\d/.test(segment)) return true;
  if (/^[A-Z]{1,3}\d{1,2}[A-Z]?$/i.test(segment)) return true;
  return false;
}
