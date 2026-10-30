import axios from 'axios';
import { useAuth } from '../state/AuthContext.jsx';

const baseURL =
  import.meta.env.VITE_API_BASE_URL || '/api';

export const api = axios.create({
  baseURL
});

export const useAuthApi = () => {
  const { token, logout } = useAuth();

  const instance = axios.create({
    baseURL
  });

  instance.interceptors.request.use((config) => {
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401) {
        logout();
      }
      return Promise.reject(err);
    }
  );

  return instance;
};

