import { Navigate, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import AnalyticsPage from './pages/AnalyticsPage'
import DashboardPage from './pages/DashboardPage'
import FlashcardsPage from './pages/FlashcardsPage'
import GameReviewPage from './pages/GameReviewPage'
import GamesPage from './pages/GamesPage'
import ImportPage from './pages/ImportPage'
import SettingsPage from './pages/SettingsPage'

export default function App(): React.JSX.Element {
  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/review" element={<GameReviewPage />} />
          <Route path="/review/:gameId" element={<GameReviewPage />} />
          <Route path="/flashcards" element={<FlashcardsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
