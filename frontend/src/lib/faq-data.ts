export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'what-is-niffyinsur',
    category: 'General',
    question: 'What is NiffyInsur?',
    answer:
      'NiffyInsur is a decentralized, parametric insurance protocol built on the Stellar blockchain. It lets you get coverage for smart contract risks with transparent, community-driven claim voting via DAO governance.',
  },
  {
    id: 'how-does-coverage-work',
    category: 'Coverage',
    question: 'How does coverage work?',
    answer:
      'You submit a quote for your smart contract, choose a coverage amount and duration, and pay the premium in XLM or a supported SEP-41 token. If a qualifying event occurs, you file a claim and DAO members vote on it. Approved claims are paid out automatically by the smart contract.',
  },
  {
    id: 'what-is-covered',
    category: 'Coverage',
    question: 'What types of contracts are covered?',
    answer:
      'We currently support DeFi protocols, general smart contracts, liquidity pools, and bridge contracts on the Stellar Soroban network. Coverage eligibility depends on the risk assessment at quote time.',
  },
  {
    id: 'how-to-file-claim',
    category: 'Claims',
    question: 'How do I file a claim?',
    answer:
      'Navigate to your active policy, click "File Claim", provide a description and supporting evidence (images/documents), and submit. DAO members will review and vote within the voting window defined in your policy terms.',
  },
  {
    id: 'claim-voting',
    category: 'Claims',
    question: 'How does claim voting work?',
    answer:
      'Token holders with voting power participate in claim decisions. Each claim has a defined voting window. If the approve votes exceed the reject votes and meet the quorum threshold, the claim is approved and paid out automatically.',
  },
  {
    id: 'premium-calculation',
    category: 'Pricing',
    question: 'How is my premium calculated?',
    answer:
      'Premiums are calculated on-chain via the Soroban smart contract based on your coverage amount, contract type, risk category, and duration. The quote is valid for a limited time and reflects current risk parameters.',
  },
  {
    id: 'wallet-required',
    category: 'Getting Started',
    question: 'Do I need a Stellar wallet?',
    answer:
      'Yes. You need a Stellar-compatible wallet (such as Freighter) to sign transactions and authenticate. Your wallet address serves as your identity on the platform — no email or password required.',
  },
  {
    id: 'legal-disclaimer',
    category: 'Legal',
    question: 'Does NiffyInsur provide legal advice?',
    answer:
      'No. NiffyInsur is a technology platform and does not provide legal, financial, or insurance advice. For questions about your specific legal situation or regulatory compliance, please consult a qualified legal professional in your jurisdiction.',
  },
  {
    id: 'data-privacy',
    category: 'Privacy',
    question: 'What data do you collect?',
    answer:
      'On-chain interactions are public by nature of the Stellar blockchain. Off-chain, we collect only what is necessary to operate the service. Support tickets store your email and message. FAQ usage is tracked as anonymous counters only — no personal data is linked to FAQ interactions.',
  },
  {
    id: 'discord-community',
    category: 'Community',
    question: 'Where can I get community support?',
    answer:
      'Join our Discord server for community discussions, announcements, and peer support. For technical issues or account-specific questions, use the contact form below to reach our support team directly.',
  },
];
