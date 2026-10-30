import type { Color } from "./types.ts";

export interface LabelTemplateItem {
  name: string;
  color: Color;
  /** Given to the auto-labeler so it knows what belongs here. */
  description: string;
}

export interface LabelTemplate {
  id: string;
  name: string;
  blurb: string;
  labels: LabelTemplateItem[];
}

export const LABEL_TEMPLATES: readonly LabelTemplate[] = [
  {
    id: "founder",
    name: "Founder",
    blurb: "Fundraising, customers, team",
    labels: [
      { name: "Investors", color: "purple", description: "Investors, VCs, angels, fundraising, board updates, term sheets" },
      { name: "Customers", color: "blue", description: "Customers and prospects writing about the product, sales, support escalations" },
      { name: "Hiring", color: "green", description: "Candidates, recruiters, interviews, offers, job applications" },
      { name: "Legal", color: "amber", description: "Lawyers, contracts, NDAs, incorporation, compliance, signatures" },
    ],
  },
  {
    id: "developer",
    name: "Developer",
    blurb: "Builds, alerts, code review",
    labels: [
      { name: "Deploys", color: "teal", description: "Deployment and build results from Vercel, Netlify, Fly, CI pipelines" },
      { name: "Alerts", color: "pink", description: "Monitoring alerts, incidents, uptime, error tracking (Sentry, Datadog, PagerDuty)" },
      { name: "GitHub", color: "gray", description: "GitHub notifications: pull requests, issues, reviews, mentions" },
      { name: "Billing", color: "amber", description: "Invoices, receipts and usage bills from cloud and SaaS vendors" },
    ],
  },
  {
    id: "freelancer",
    name: "Freelancer",
    blurb: "Clients, invoices, leads",
    labels: [
      { name: "Clients", color: "blue", description: "Existing clients discussing ongoing projects and deliverables" },
      { name: "Invoices", color: "green", description: "Invoices sent or received, payment confirmations, overdue reminders" },
      { name: "Leads", color: "purple", description: "New project inquiries, referrals and potential clients" },
    ],
  },
  {
    id: "personal",
    name: "Personal",
    blurb: "Family, trips, receipts",
    labels: [
      { name: "Family", color: "pink", description: "Family members and close friends" },
      { name: "Travel", color: "teal", description: "Flights, hotels, bookings, itineraries, boarding passes" },
      { name: "Receipts", color: "gray", description: "Order confirmations, purchase receipts, shipping updates" },
    ],
  },
];
