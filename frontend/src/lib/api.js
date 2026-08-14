import axios from "axios";

const configuredBackend = process.env.REACT_APP_BACKEND_URL;
if (process.env.NODE_ENV === "production" && !configuredBackend) {
  throw new Error("REACT_APP_BACKEND_URL is required for a production build");
}
const BACKEND_URL = configuredBackend || "http://localhost:8000";
export const API = `${BACKEND_URL.replace(/\/$/, "")}/api`;

export const adminApi = axios.create({ baseURL: API, withCredentials: true });
export const workerApi = axios.create({ baseURL: API, withCredentials: true });

let adminCsrf = null;
let workerCsrf = null;
export const setAdminCsrf = (value) => { adminCsrf = value || null; };
export const setWorkerCsrf = (value) => { workerCsrf = value || null; };

const csrfInterceptor = (getToken) => (config) => {
  if (["post", "put", "patch", "delete"].includes(config.method) && getToken()) {
    config.headers = config.headers || {};
    config.headers["X-CSRF-Token"] = getToken();
  }
  return config;
};
adminApi.interceptors.request.use(csrfInterceptor(() => adminCsrf));
workerApi.interceptors.request.use(csrfInterceptor(() => workerCsrf));

export function apiError(e) {
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg || JSON.stringify(d)).join(" ");
  if (e?.request && !e?.response) {
    return "Cannot connect to WorkForce server. Server से connection नहीं हो पा रहा है। Backend चालू है या नहीं, कृपया जाँचें।";
  }
  return e?.message || "Something went wrong";
}

export const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
