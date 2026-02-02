import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import NewProject from './pages/NewProject'
import Subcontractors from './pages/Subcontractors'
import SubcontractorDetail from './pages/SubcontractorDetail'
import NewSubcontractor from './pages/NewSubcontractor'
import Bids from './pages/Bids'
import QuickBidEntry from './pages/QuickBidEntry'
import Trades from './pages/Trades'
import EmailParser from './pages/EmailParser'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/new" element={<NewProject />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="subcontractors" element={<Subcontractors />} />
        <Route path="subcontractors/new" element={<NewSubcontractor />} />
        <Route path="subcontractors/:id" element={<SubcontractorDetail />} />
        <Route path="bids" element={<Bids />} />
        <Route path="bids/quick-entry" element={<QuickBidEntry />} />
        <Route path="trades" element={<Trades />} />
        <Route path="email-parser" element={<EmailParser />} />
      </Route>
    </Routes>
  )
}

export default App
