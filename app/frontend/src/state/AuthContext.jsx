import React, { createContext, useContext, useEffect, useState } from 'react';
import { jwtDecode } from 'jwt-decode';

const AuthContext = createContext(null);

const STORAGE_KEY = 'jaynetic_auth_token';

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('jaynetic_auth_user');
    return stored ? JSON.parse(stored) : null;
  });

  useEffect(() => {
    if (token) {
      try {
        const decoded = jwtDecode(token);
        if (!user) {
          setUser({
            id: decoded.id,
            role: decoded.role
          });
        }
      } catch {
        setToken(null);
        setUser(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    } else {
      setUser(null);
    }
  }, [token, user]);

  const login = (newToken, userPayload) => {
    setToken(newToken);
    localStorage.setItem(STORAGE_KEY, newToken);
    const finalUser = userPayload || user;
    if (finalUser) {
      setUser(finalUser);
      localStorage.setItem('jaynetic_auth_user', JSON.stringify(finalUser));
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('jaynetic_auth_user');
  };

  const updateUser = (updated) => {
    const finalUser = { ...(user || {}), ...updated };
    setUser(finalUser);
    localStorage.setItem('jaynetic_auth_user', JSON.stringify(finalUser));
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated: Boolean(token),
        isAdmin: user?.role === 'admin',
        login,
        logout,
        updateUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);


