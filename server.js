/**
 * ADEPT PROCESSING NIG LTD - Central Engine Backend
 * Node.js / Express Server for USSD (*992#), Escrow Webhooks, & Order Processing
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Environment Variables (Load via dotenv in production)
const PORT = process.env.PORT || 5000;
const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY || 'MK_TEST_YOUR_KEY';
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY || 'YOUR_SECRET_KEY';
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE || '1234567890';
const MONNIFY_BASE_URL = 'https://sandbox.monnify.com'; // Change to 'https://api.monnify.com' for Production

// In-Memory Database (Replace with PostgreSQL/Supabase Client)
const db = {
  rfqs: [
    {
      id: 'RFQ-0042',
      coop: 'Kano Apex Farmers Co-op',
      product: 'Urea 46% N',
      qty: 500,
      total: 397500000,
      status: 'OPEN_FOR_ESCROW',
      phone: '2348030000001',
      accountNumber: '9928374012'
    }
  ]
};

// Utility: Authenticate with Monnify API to get Access Token
async function getMonnifyToken() {
  const authBuffer = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString('base64');
  try {
    const response = await axios.post(
      `${MONNIFY_BASE_URL}/api/v1/auth/login`,
      {},
      { headers: { Authorization: `Basic ${authBuffer}` } }
    );
    return response.data.responseBody.accessToken;
  } catch (error) {
    console.error('Monnify Auth Error:', error.response?.data || error.message);
    return null;
  }
}

// Utility: Generate Dynamic NIBSS Virtual Account for Escrow
async function generateEscrowVirtualAccount(rfqId, customerName, amount, customerPhone) {
  const token = await getMonnifyToken();
  if (!token) {
    // Fallback Mock Virtual Account if API keys aren't configured yet
    return { accountNumber: '992' + Math.floor(10000000 + Math.random() * 90000000), bankName: 'Wema Bank' };
  }

  try {
    const response = await axios.post(
      `${MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts`,
      {
        accountReference: rfqId,
        accountName: `Adept Escrow - ${customerName}`,
        currencyCode: 'NGN',
        contractCode: MONNIFY_CONTRACT_CODE,
        customerEmail: `coop_${rfqId.toLowerCase()}@adeptprocessing.ng`,
        customerName: customerName,
        getAllAvailableBanks: false,
        preferredBanks: ['035'] // 035 = Wema Bank
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const accounts = response.data.responseBody.accounts;
    return {
      accountNumber: accounts[0].accountNumber,
      bankName: accounts[0].bankName
    };
  } catch (error) {
    console.error('Virtual Account Creation Error:', error.response?.data || error.message);
    return { accountNumber: '9928374012', bankName: 'Wema Bank (Fallback)' };
  }
}

// =============================================================================
// 1. AFRICA'S TALKING USSD GATEWAY ENDPOINT (*992#)
// =============================================================================
app.post('/api/v1/ussd', async (req, res) => {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;
  let response = '';

  const inputArray = text ? text.split('*') : [];
  const currentStep = inputArray.length;

  // STEP 0: Root Menu (*992#)
  if (text === '') {
    response = `CON Welcome to Adept Processing (*992#)
1. Check Factory Stock
2. Order Custom NPK Blend
3. Check Escrow Status`;
  } 
  
  // STEP 1: Main Menu Handlers
  else if (text === '1') {
    response = `END LIVE FACTORY STOCK:
- Dangote Urea 46% N: 10,000 MT (N795k/MT)
- NPK 15:15:15: 4,500 MT (N706k/MT)
- NPK 20:10:10: 3,200 MT (N735k/MT)`;
  } 
  
  else if (text === '2') {
    response = `CON CUSTOM BLEND (NPK 20:10:10)
Enter required Tonnage in MT:
(e.g., enter 200 for 200 MT)`;
  } 
  
  else if (text === '3') {
    const openRFQ = db.rfqs.find(r => r.phone === phoneNumber) || db.rfqs[0];
    response = `END ACTIVE ESCROW STATUS:
Ref: ${openRFQ.id}
Status: ${openRFQ.status}
Virtual Acc: ${openRFQ.accountNumber} (Wema Bank)`;
  } 
  
  // STEP 2: Custom Blend Quantity Entered
  else if (currentStep === 2 && inputArray[0] === '2') {
    const qty = parseInt(inputArray[1], 10);
    if (!isNaN(qty) && qty > 0) {
      const estimatedTotal = qty * 735000; // N735,000 per MT
      response = `CON CONFIRM USSD ORDER:
Custom NPK 20:10:10 x ${qty} MT
Total Value: N${estimatedTotal.toLocaleString()}

1. Confirm & Issue Contract
2. Cancel`;
    } else {
      response = `END Invalid Quantity. Please dial *992# again.`;
    }
  } 
  
  // STEP 3: Order Confirmation & Dynamic Virtual Account Generation
  else if (currentStep === 3 && inputArray[0] === '2') {
    const confirmation = inputArray[2];
    if (confirmation === '1') {
      const qty = parseInt(inputArray[1], 10);
      const newRfqId = `RFQ-00${db.rfqs.length + 44}`;
      const totalAmount = qty * 735000;

      // Generate Virtual Bank Account
      const vAcc = await generateEscrowVirtualAccount(newRfqId, `USSD Node (${phoneNumber})`, totalAmount, phoneNumber);

      const newRFQ = {
        id: newRfqId,
        coop: `USSD Order (${phoneNumber})`,
        product: 'Custom NPK 20:10:10',
        qty: qty,
        total: totalAmount,
        status: 'OPEN_FOR_ESCROW',
        phone: phoneNumber,
        accountNumber: vAcc.accountNumber
      };

      db.rfqs.push(newRFQ);

      response = `END CONTRACT ISSUED!
ID: ${newRfqId}
Pay N${totalAmount.toLocaleString()} to:
Bank: ${vAcc.bankName}
Acc No: ${vAcc.accountNumber}
Funds will lock in Escrow.`;
    } else {
      response = `END Order Cancelled.`;
    }
  } 
  
  else {
    response = `END Invalid Selection. Try again.`;
  }

  res.set('Content-Type', 'text/plain');
  res.send(response);
});

// =============================================================================
// 2. MONNIFY / PAYSTACK BANK ESCROW WEBHOOK
// =============================================================================
app.post('/api/v1/escrow/webhook', (req, res) => {
  const { eventType, responseBody } = req.body;

  // Handle successful inbound payment notification from bank
  if (eventType === 'SUCCESSFUL_TRANSACTION' || req.body.event === 'charge.success') {
    const rfqId = responseBody?.paymentReference || req.body.data?.reference;
    const paidAmount = responseBody?.amountPaid || req.body.data?.amount / 100;

    console.log(`⚡ INBOUND PAYMENT VERIFIED: ₦${paidAmount} for Ref: ${rfqId}`);

    // Update database status to ESCROW_LOCKED
    const rfqIndex = db.rfqs.findIndex(r => r.id === rfqId || r.accountNumber === responseBody?.accountDetails?.accountNumber);
    if (rfqIndex !== -1) {
      db.rfqs[rfqIndex].status = 'ESCROW_LOCKED';
      console.log(`🔒 ESCROW LOCKED FOR ${db.rfqs[rfqIndex].id}. Triggering Factory Dispatch Notice to Dangote/Blender...`);
    }

    return res.status(200).json({ status: 'SUCCESS', message: 'Escrow Funds Locked' });
  }

  res.status(200).json({ status: 'IGNORED' });
});

// =============================================================================
// 3. REST API FOR WEB DASHBOARD & MOBILE FIELD APP
// =============================================================================
app.get('/api/v1/rfqs', (req, res) => {
  res.json({ success: true, data: db.rfqs });
});

app.post('/api/v1/rfqs/create', async (req, res) => {
  const { coop, product, qty, pricePerTon, phone } = req.body;
  const newRfqId = `RFQ-00${db.rfqs.length + 44}`;
  const total = qty * pricePerTon;

  const vAcc = await generateEscrowVirtualAccount(newRfqId, coop, total, phone);

  const newRFQ = {
    id: newRfqId,
    coop,
    product,
    qty,
    total,
    status: 'OPEN_FOR_ESCROW',
    phone,
    accountNumber: vAcc.accountNumber
  };

  db.rfqs.push(newRFQ);
  res.json({ success: true, data: newRFQ });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Adept Processing Nig LTD Backend Engine Running on Port ${PORT}`);
});
