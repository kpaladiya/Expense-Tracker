import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, FileText, LifeBuoy, MessageSquare, Send, ShieldCheck } from 'lucide-react';
import { useAuth } from '../services/AuthContext';
import { supportAPI } from '../services/api';
import SiteFooter from '../components/SiteFooter';

const PAGE_CONTENT = {
  terms: {
    title: 'Terms & Conditions',
    subtitle: 'Basic rules for using Shared Expenses responsibly.',
    icon: FileText,
    lastUpdated: 'May 2026',
    sections: [
      {
        id: 'using-the-app',
        heading: 'Using the app',
        body: 'Use Shared Expenses only for genuine personal, household, or team expense tracking. You are responsible for the information you add to your groups, expenses, payments, and settlements.'
      },
      {
        id: 'account-responsibility',
        heading: 'Account responsibility',
        body: 'Keep your account credentials safe. Activity performed from your account is treated as your own activity unless you report an issue.'
      },
      {
        id: 'data-accuracy',
        heading: 'Data accuracy',
        body: 'Members should enter correct amounts, dates, and notes. Settlements are based on the data saved in the app, so incorrect records can lead to incorrect balances.'
      },
      {
        id: 'fair-usage',
        heading: 'Fair usage',
        body: 'Do not use the app to abuse other members, upload unlawful content, or intentionally manipulate settlement data. Group admins should review member activity responsibly.'
      },
      {
        id: 'service-updates',
        heading: 'Service updates',
        body: 'Features may change over time as the app improves. Continued use after updates means you accept the revised experience and policies shown in the app.'
      }
    ]
  },
  privacy: {
    title: 'Privacy Policy',
    subtitle: 'A simple overview of the information used in the app.',
    icon: ShieldCheck,
    lastUpdated: 'May 2026',
    sections: [
      {
        id: 'what-we-store',
        heading: 'What we store',
        body: 'The app stores your account details, group memberships, expenses, payments, and settlement history so your groups can track shared finances.'
      },
      {
        id: 'how-data-is-used',
        heading: 'How data is used',
        body: 'Your data is used to calculate balances, show group activity, and send important emails such as account activation and group notifications.'
      },
      {
        id: 'sharing',
        heading: 'Sharing',
        body: 'Group members can see the financial activity that belongs to their shared groups. The app should not be used to store unnecessary sensitive information in notes.'
      },
      {
        id: 'email-notifications',
        heading: 'Email notifications',
        body: 'When enabled, the app sends transactional emails for account activation, expense activity, payment activity, and month settlement. These emails use the address stored on your account.'
      },
      {
        id: 'data-requests',
        heading: 'Data requests',
        body: 'If you need help with account information or stored feedback, contact the app owner or support channel configured for this project.'
      }
    ]
  },
  help: {
    title: 'Help',
    subtitle: 'Quick guidance for getting started.',
    icon: LifeBuoy,
    faqs: [
      {
        question: 'How do I create a group?',
        answer: 'Open the dashboard, click Create New Group, add a name and optional description, then save it. You become the admin of that group.'
      },
      {
        question: 'How do I invite members?',
        answer: 'Open a group, go to Members, and invite people using their registered email addresses. The invited person must accept before the admin approves them.'
      },
      {
        question: 'What is the difference between expenses and payments?',
        answer: 'Expenses are money a member spends for the group. Payments are money received into the group for that same work or activity.'
      },
      {
        question: 'When should I use Settle Up?',
        answer: 'Use Settle Up after a month has received money and the records for that month are complete. The month is then closed and cannot be edited anymore.'
      },
      {
        question: 'Why did I get an email notification?',
        answer: 'The app emails group members when someone adds an expense, records a payment, or settles a month, so everyone stays informed.'
      }
    ],
    quickLinks: [
      { to: '/terms', label: 'Review terms and conditions' },
      { to: '/privacy', label: 'Read the privacy policy' },
      { to: '/feedback', label: 'Send feedback or report an issue' }
    ]
  },
  feedback: {
    title: 'Feedback',
    subtitle: 'How to share issues, requests, and suggestions.',
    icon: MessageSquare
  }
};

const FEEDBACK_CATEGORIES = [
  { value: 'general', label: 'General feedback' },
  { value: 'feature', label: 'Feature request' },
  { value: 'bug', label: 'Bug report' },
  { value: 'help', label: 'Need help' }
];

export default function InfoPage({ pageKey }) {
  const { user } = useAuth();
  const page = PAGE_CONTENT[pageKey] || PAGE_CONTENT.help;
  const Icon = page.icon;
  const [helpQuery, setHelpQuery] = useState('');
  const [openFaq, setOpenFaq] = useState(0);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackNotice, setFeedbackNotice] = useState(null);
  const [feedbackForm, setFeedbackForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    category: 'general',
    subject: '',
    message: '',
    termsAccepted: false
  });

  const filteredFaqs = useMemo(() => {
    if (pageKey !== 'help') {
      return [];
    }

    const normalizedQuery = helpQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return page.faqs;
    }

    return page.faqs.filter((item) =>
      item.question.toLowerCase().includes(normalizedQuery) ||
      item.answer.toLowerCase().includes(normalizedQuery)
    );
  }, [helpQuery, page, pageKey]);

  const handleFeedbackChange = (field, value) => {
    setFeedbackForm((current) => ({
      ...current,
      [field]: value
    }));
  };

  const handleSubmitFeedback = async (event) => {
    event.preventDefault();
    setFeedbackError('');
    setFeedbackNotice(null);

    try {
      setFeedbackLoading(true);
      const result = await supportAPI.submitFeedback(feedbackForm);
      setFeedbackNotice({
        type: result.warning ? 'warning' : 'success',
        text: `${result.warning || result.message} Feedback number: ${result.data.ticketNumber}`
      });
      setFeedbackForm((current) => ({
        name: current.name,
        email: current.email,
        ...current,
        category: 'general',
        subject: '',
        message: '',
        termsAccepted: false
      }));
    } catch (error) {
      setFeedbackError(error.message || 'Failed to send feedback');
    } finally {
      setFeedbackLoading(false);
    }
  };

  const noticeClasses = feedbackNotice?.type === 'warning'
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-green-50 border-green-200 text-green-800';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-sm p-8">
          <div className="flex items-start gap-4 mb-8">
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{page.title}</h1>
              <p className="text-gray-600 mt-2">{page.subtitle}</p>
              {page.lastUpdated && (
                <p className="text-sm text-gray-500 mt-3">Last updated: {page.lastUpdated}</p>
              )}
            </div>
          </div>

          {(pageKey === 'terms' || pageKey === 'privacy') && (
            <div className="grid gap-8 lg:grid-cols-[220px,1fr]">
              <aside className="lg:sticky lg:top-8 h-fit bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-gray-900 mb-3">On this page</p>
                <div className="space-y-2">
                  {page.sections.map((section) => (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className="block text-sm text-gray-600 hover:text-blue-600 transition-colors"
                    >
                      {section.heading}
                    </a>
                  ))}
                </div>
              </aside>

              <div className="space-y-6">
                {page.sections.map((section) => (
                  <section id={section.id} key={section.id} className="border border-gray-200 rounded-lg p-5 scroll-mt-8">
                    <h2 className="text-lg font-semibold text-gray-900 mb-2">{section.heading}</h2>
                    <p className="text-gray-600 leading-7">{section.body}</p>
                  </section>
                ))}
              </div>
            </div>
          )}

          {pageKey === 'help' && (
            <div className="space-y-8">
              <div className="grid gap-4 md:grid-cols-[1fr,auto] md:items-center">
                <input
                  type="text"
                  value={helpQuery}
                  onChange={(event) => setHelpQuery(event.target.value)}
                  placeholder="Search help topics"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Link
                  to="/feedback"
                  className="inline-flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Contact support
                </Link>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {page.quickLinks.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="border border-gray-200 rounded-lg p-4 text-sm font-medium text-gray-700 hover:border-blue-300 hover:text-blue-600 transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              <div className="space-y-4">
                {filteredFaqs.length === 0 ? (
                  <div className="border border-gray-200 rounded-lg p-5 text-gray-600">
                    No help topics matched your search. Try a different word or send feedback.
                  </div>
                ) : (
                  filteredFaqs.map((faq, index) => {
                    const isOpen = openFaq === index;
                    return (
                      <div key={faq.question} className="border border-gray-200 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setOpenFaq(isOpen ? -1 : index)}
                          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                        >
                          <span className="font-medium text-gray-900">{faq.question}</span>
                          <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isOpen && (
                          <div className="px-5 pb-5 text-gray-600 leading-7">
                            {faq.answer}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {pageKey === 'feedback' && (
            <div className="grid gap-8 lg:grid-cols-[0.9fr,1.1fr]">
              <div className="space-y-4">
                <div className="border border-gray-200 rounded-lg p-5">
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">Send a message</h2>
                  <p className="text-gray-600 leading-7">
                    Use this form to report a bug, request a feature, ask for help, or share general feedback.
                    Your message is saved in the app backend so it can be reviewed later.
                  </p>
                </div>
                <div className="border border-gray-200 rounded-lg p-5">
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">Helpful feedback includes</h2>
                  <div className="space-y-2 text-gray-600">
                    <p>1. What you were trying to do</p>
                    <p>2. What happened instead</p>
                    <p>3. Group name or screen name if relevant</p>
                    <p>4. Any steps needed to reproduce the issue</p>
                  </div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-6">
                <form onSubmit={handleSubmitFeedback} className="space-y-4">
                  {feedbackNotice && (
                    <div className={`border rounded-lg px-4 py-3 text-sm ${noticeClasses}`}>
                      {feedbackNotice.text}
                    </div>
                  )}
                  {feedbackError && (
                    <div className="border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800 bg-red-50">
                      {feedbackError}
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
                      <input
                        type="text"
                        value={feedbackForm.name}
                        onChange={(event) => handleFeedbackChange('name', event.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                      <input
                        type="email"
                        value={feedbackForm.email}
                        onChange={(event) => handleFeedbackChange('email', event.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                    <select
                      value={feedbackForm.category}
                      onChange={(event) => handleFeedbackChange('category', event.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {FEEDBACK_CATEGORIES.map((category) => (
                        <option key={category.value} value={category.value}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
                    <input
                      type="text"
                      value={feedbackForm.subject}
                      onChange={(event) => handleFeedbackChange('subject', event.target.value)}
                      placeholder="Short summary"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Message</label>
                    <textarea
                      value={feedbackForm.message}
                      onChange={(event) => handleFeedbackChange('message', event.target.value)}
                      placeholder="Explain the issue, idea, or help request"
                      rows="6"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <label className="flex items-start gap-3 border border-gray-200 rounded-lg p-4">
                    <input
                      type="checkbox"
                      checked={feedbackForm.termsAccepted}
                      onChange={(event) => handleFeedbackChange('termsAccepted', event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      required
                    />
                    <span className="text-sm text-gray-600 leading-6">
                      I agree to the{' '}
                      <Link to="/terms" className="text-blue-600 hover:text-blue-700">
                        Terms & Conditions
                      </Link>{' '}
                      and understand this feedback will be stored so the team can review it.
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={feedbackLoading}
                    className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    {feedbackLoading ? 'Sending...' : 'Submit feedback'}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
