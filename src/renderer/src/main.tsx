import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App } from './App'
import { SessionListPage } from './routes/SessionListPage'
import { SessionDetailPage } from './routes/SessionDetailPage'
import { DigestsPage } from './routes/DigestsPage'
import { SettingsPage } from './routes/SettingsPage'
import { StatsPage } from './routes/StatsPage'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/sessions" replace />} />
          <Route path="sessions" element={<SessionListPage />} />
          <Route path="sessions/:id" element={<SessionDetailPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="digests" element={<DigestsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>
)
