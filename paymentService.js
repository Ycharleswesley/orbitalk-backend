const crypto = require('crypto');
const Razorpay = require('razorpay');

// Define the available packages and their details
const PACKAGES = {
    'bronze': { amount: 699, currency: 'INR', name: 'Bronze Pack', durationMonths: 1, limitSeconds: 10 * 60, limitMessages: 1000 },
    'silver': { amount: 1299, currency: 'INR', name: 'Silver Pack', durationMonths: 3, limitSeconds: 20 * 60, limitMessages: 2000 },
    'gold': { amount: 1999, currency: 'INR', name: 'Gold Pack', durationMonths: 6, limitSeconds: 45 * 60, limitMessages: 5000 }
};

let razorpay = null;

// Initialize razorpay securely using environment variables
function initRazorpay() {
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
        console.log("Razorpay initialized successfully.");
    } else {
        console.warn("Razorpay keys not found in .env. Payment features will not work.");
    }
}

// Handle payment related requests
async function handlePaymentRoutes(req, res, firebaseAdmin) {
    if (req.method === 'GET' && req.url === '/payment-packages') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(PACKAGES));
        return true;
    }

    if (req.method === 'POST' && req.url === '/create-razorpay-order') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                if (!razorpay) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Razorpay keys not configured in backend' }));
                    return;
                }
                const bodyData = JSON.parse(body);

                // Allow dynamic amount but fallback to package if packageId is passed
                let orderAmount = bodyData.amount;
                let currency = bodyData.currency || 'INR';

                if (bodyData.packageId && PACKAGES[bodyData.packageId]) {
                    orderAmount = PACKAGES[bodyData.packageId].amount;
                    currency = PACKAGES[bodyData.packageId].currency;
                }

                if (!orderAmount) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid or missing amount' }));
                    return;
                }

                // Amount is typically sent in base currency (e.g., rupees), so multiply by 100 for paise
                const options = {
                    amount: Math.round(orderAmount * 100),
                    currency: currency,
                    receipt: "receipt_" + Date.now(),
                    notes: bodyData.packageId ? { package: PACKAGES[bodyData.packageId].name } : {}
                };

                const order = await razorpay.orders.create(options);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ...order, packageId: bodyData.packageId }));
            } catch (e) {
                console.error('(API) Razorpay Order Error:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to create order' }));
            }
        });
        return true;
    }

    if (req.method === 'POST' && req.url === '/verify-razorpay-payment') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { razorpay_order_id, razorpay_payment_id, razorpay_signature, packageId, userId } = JSON.parse(body);
                const text = razorpay_order_id + "|" + razorpay_payment_id;
                const expectedSignature = crypto
                    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
                    .update(text.toString())
                    .digest("hex");

                if (expectedSignature === razorpay_signature) {
                    // Payment is successful, update Database
                    const pkg = PACKAGES[packageId];
                    console.log(`Razorpay success! Validating DB update for User: ${userId}, Package: ${packageId}, PkgExists: ${!!pkg}, AdminExists: ${!!firebaseAdmin}`);
                    if (userId && pkg && firebaseAdmin) {
                        const db = firebaseAdmin.firestore();
                        const startDate = new Date();
                        const endDate = new Date();
                        endDate.setMonth(endDate.getMonth() + pkg.durationMonths);

                        await db.collection('users').doc(userId).update({
                            plan_type: packageId,
                            plan_status: 'active',
                            plan_start_date: startDate.toISOString(),
                            plan_end_date: endDate.toISOString(),
                            payment_id: razorpay_payment_id,
                            subscription_id: razorpay_order_id,
                            remaining_messages: firebaseAdmin.firestore.FieldValue.increment(pkg.limitMessages),
                            remaining_call_seconds: firebaseAdmin.firestore.FieldValue.increment(pkg.limitSeconds)
                        });
                        console.log(`Successfully updated Firestore for user ${userId} with package ${packageId}`);
                    } else {
                        console.log(`DB Update Skipped. Missing variable.`);
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: "Payment verified successfully" }));
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: "Invalid signature" }));
                }
            } catch (e) {
                console.error('(API) Razorpay Verification Error:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Verification Failed' }));
            }
        });
        return true;
    }

    return false; // Route not handled by paymentService
}

module.exports = {
    initRazorpay,
    handlePaymentRoutes,
    PACKAGES
};
