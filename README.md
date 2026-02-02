# BidCoordinator

**AI-Powered Subcontractor Bid Management for Commercial Contractors**

BidCoordinator is a modern web application that helps commercial contractors manage subcontractor bids efficiently. Create bid sheets from project drawings, track all subcontractor communications, organize bids by trade using CSI divisions, and leverage AI to automatically parse bid information from forwarded emails.

## Features

- **Project Management**: Create and manage construction projects with bid dates, locations, and client information
- **Bid Item Organization**: Break down projects into bid items organized by CSI MasterFormat trades
- **Subcontractor Database**: Maintain a database of subcontractors with contact info, trades, ratings, and preferences
- **Bid Tracking**: Track bid invitations, submissions, and awards across all projects
- **AI Email Parsing**: Forward bid emails and let Claude AI extract bid amounts, inclusions, exclusions, and more
- **Quick Bid Entry**: Rapidly enter bids received by phone or fax
- **Bid Comparison**: Compare bids side-by-side by trade to make informed decisions
- **Export to Excel**: Export bid packages, tabulations, and subcontractor lists

## Tech Stack

- **Frontend**: React 18, Tailwind CSS, React Router
- **Backend**: Netlify Functions (Serverless)
- **Database**: Supabase (PostgreSQL)
- **AI**: Anthropic Claude API
- **Build**: Vite
- **Hosting**: Netlify

## Quick Start

### Prerequisites

- Node.js 18+
- A Supabase account (free tier works)
- An Anthropic API key (for AI email parsing)

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/AIbidcoordinator.git
cd AIbidcoordinator
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to the SQL Editor in your Supabase dashboard
3. Copy and paste the contents of `supabase/schema.sql` and run it
4. This creates all necessary tables and populates CSI trade divisions

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```env
# Supabase (from your project settings)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Anthropic (from console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-your-key
```

### 4. Run Locally

```bash
# Start the development server
npm run dev

# In another terminal, start Netlify Functions
npx netlify dev
```

Visit `http://localhost:5173` to use the application.

## Deployment to Netlify

### One-Click Deploy

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/yourusername/AIbidcoordinator)

### Manual Deploy

1. Push your code to GitHub
2. Connect your repo to Netlify
3. Add environment variables in Netlify's dashboard:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY`
4. Deploy!

## Usage Guide

### Creating a Project

1. Click "New Project" from the dashboard
2. Enter project details (name, number, location, bid date, etc.)
3. Add bid items organized by trade (e.g., "Concrete - Foundations", "Electrical - Rough-In")
4. Upload project drawings (optional)

### Managing Subcontractors

1. Go to "Subcontractors" and click "Add Subcontractor"
2. Enter company info, contact details, and select their trades
3. Mark preferred subcontractors and add ratings
4. Import from CSV for bulk additions

### Inviting Bids

1. Open a project and click "Invite Subs"
2. Select bid items and subcontractors to invite
3. The system creates bid invitations for tracking

### Entering Bids

**Quick Entry** (for phone/fax bids):
1. Go to "Quick Bid Entry"
2. Select project, bid item, and subcontractor
3. Enter amount, inclusions, exclusions
4. Save - communication is automatically logged

**AI Email Parser** (for emailed bids):
1. Go to "Parse Bid Email"
2. Paste the forwarded email content
3. AI extracts bid information automatically
4. Review, adjust if needed, and save

### Comparing Bids

1. Open a project and expand trades to see all bids
2. Click "Export" to download Excel comparison sheets
3. Accept winning bids directly from the interface

## CSI MasterFormat Divisions

The system comes pre-loaded with standard CSI MasterFormat divisions:

| Division | Name |
|----------|------|
| 01 | General Requirements |
| 02 | Existing Conditions |
| 03 | Concrete |
| 04 | Masonry |
| 05 | Metals |
| 06 | Wood, Plastics, and Composites |
| 07 | Thermal and Moisture Protection |
| 08 | Openings |
| 09 | Finishes |
| 10 | Specialties |
| 11 | Equipment |
| 12 | Furnishings |
| 13 | Special Construction |
| 14 | Conveying Equipment |
| 21 | Fire Suppression |
| 22 | Plumbing |
| 23 | HVAC |
| 25 | Integrated Automation |
| 26 | Electrical |
| 27 | Communications |
| 28 | Electronic Safety and Security |
| 31 | Earthwork |
| 32 | Exterior Improvements |
| 33 | Utilities |

You can add custom trades from the Trades page.

## API Endpoints

### Netlify Functions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/parse-email` | POST | AI-powered email parsing |

### Supabase (Direct Client Access)

The frontend connects directly to Supabase for CRUD operations on:
- Projects
- Subcontractors
- Bid Items
- Bids
- Trades
- Communications

## Project Structure

```
AIbidcoordinator/
├── netlify/
│   └── functions/         # Serverless API functions
│       └── parse-email.js # Anthropic AI email parser
├── public/                # Static assets
├── src/
│   ├── components/        # Reusable React components
│   │   └── Layout.jsx     # Main app layout with sidebar
│   ├── lib/
│   │   ├── supabase.js    # Database client and helpers
│   │   └── export.js      # Excel/CSV export utilities
│   ├── pages/             # Page components
│   │   ├── Dashboard.jsx
│   │   ├── Projects.jsx
│   │   ├── ProjectDetail.jsx
│   │   ├── Subcontractors.jsx
│   │   ├── Bids.jsx
│   │   ├── QuickBidEntry.jsx
│   │   ├── Trades.jsx
│   │   └── EmailParser.jsx
│   ├── App.jsx            # Routes configuration
│   ├── main.jsx           # Entry point
│   └── index.css          # Tailwind styles
├── supabase/
│   └── schema.sql         # Database schema
├── netlify.toml           # Netlify configuration
├── package.json
├── tailwind.config.js
└── vite.config.js
```

## Security Notes

- Supabase Row Level Security (RLS) can be enabled for multi-user support
- API keys are stored as environment variables, never in code
- The Anthropic API key is only used server-side in Netlify Functions

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this for your contracting business.

## Support

For issues or feature requests, please open a GitHub issue.

---

Built with React, Supabase, and Anthropic Claude
