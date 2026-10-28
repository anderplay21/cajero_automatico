import { ATM_ID } from './config.js';

export function createSeedData() {
  return {
    atmId: ATM_ID,
    inventory: {
      100000: 30,
      50000: 40,
      20000: 60,
      10000: 80,
    },
    customers: [
      {
        id: 'cus-ana',
        name: 'Ana María Gómez',
        document: 'CC 1.020.304.556',
        phone: '+57 300 123 4567',
      },
    ],
    accounts: [
      {
        id: 'acc-ahorros-ana',
        customerId: 'cus-ana',
        type: 'Ahorros',
        number: '**** 8834',
        balance: 3_500_000,
        currency: 'COP',
      },
    ],
    cards: [
      {
        id: 'card-debit-ana',
        kind: 'debit',
        customerId: 'cus-ana',
        accountId: 'acc-ahorros-ana',
        masked: '4512 •••• •••• 8834',
        pan: '45128834',
        pin: '1234',
        status: 'active',
        holder: 'ANA M. GOMEZ',
        expiry: '09/29',
        network: 'VISA',
      },
      {
        id: 'card-credit-ana',
        kind: 'credit',
        customerId: 'cus-ana',
        accountId: null,
        masked: '5214 •••• •••• 2017',
        pan: '52142017',
        pin: '4321',
        status: 'active',
        holder: 'ANA M. GOMEZ',
        expiry: '11/28',
        network: 'MASTERCARD',
        creditLimit: 5_000_000,
        availableCredit: 2_000_000,
      },
    ],
  };
}
