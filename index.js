const express = require("express");
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 3000;


//middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("book courier server is running");
});

function generateTrackingId() {
  const prefix = "LIB";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}

const uri =
  `${process.env.URI}`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('BookCourier_DB');
    const userCollection = db.collection('users');
    const bookCollection = db.collection('books');
    const orderCollection = db.collection('orders');
    const paymentCollection = db.collection('payments');

    //user related api
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExist = await userCollection.findOne({ email });
      if (userExist) {
        return res.send({ message: "User already exist" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });


    //book related api
    app.post('/books', async (req, res) => {
      const newBook = req.body;
      newBook.createdAt = new Date();
      const result = await bookCollection.insertOne(newBook);
      res.send(result);
    })

    app.get('/latest-books', async (req, res) => {
      const query = { bookStatus: 'Published' };
      const result = await bookCollection.find(query).sort({ createdAt: -1 }).limit(6).toArray();
      res.send(result);
    })

    app.get('/all-books', async (req, res) => {
       const {
         limit = 0,
         skip = 0,
         sort = "price",
         order = "asc",
         search = "",
       } = req.query;
      const sortOption = {};
      sortOption[sort || "price"] = order === "asc" ? 1 : -1;
      if (search) {
        query.$or = [
          { bookName: { $regex: search, $options: "i" } },
          { bookAuthor: { $regex: search, $options: "i" } },
          { bookPrice: { $regex: search, $options: "i" } },
        ];
      }
      const query = { bookStatus: 'Published' };
      const result = await bookCollection
        .find(query)
        .sort(sortOption)
        .limit(Number(limit))
        .skip(Number(skip))
        .toArray();
      const count = await bookCollection.countDocuments(query);
      res.send({ result, total: count });
    })

    app.get("/all-books/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookCollection.findOne(query);
      res.send(result);
    })

    //orders related api.
    app.post('/orders', async (req, res) => {
      const order = req.body;
      order.orderStatus = 'pending';
      order.paymentStatus = 'unpaid';
      order.createdAt = new Date();
      const result = await orderCollection.insertOne(order);
      res.send(result);
    })

    app.get('/orders', async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.customerEmail = email;
      }
      const result = await orderCollection.find(query).toArray();
      res.send(result);
    })

    app.patch("/orders/cancel/:id", async (req, res) => {
      const id = req.params.id;
      const result = await orderCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { orderStatus: "cancelled" } },
      );
      res.send(result);
    });


    //payment related api
     app.post("/create-checkout-session", async (req, res) => {
       const paymentInfo = req.body;
       const amount = parseInt(paymentInfo.amount) * 100;
       const session = await stripe.checkout.sessions.create({
         line_items: [
           {
             price_data: {
               currency: "USD",
               unit_amount: amount,
               product_data: {
                 name: `Please pay for: ${paymentInfo.bookName}`,
               },
             },
             quantity: 1,
           },
         ],
         customer_email: paymentInfo.customerEmail,
         metadata: {
           orderId: paymentInfo.orderId,
           productName: paymentInfo.bookName,
         },
         mode: "payment",
         success_url: `${process.env.SITE_DIMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
         cancel_url: `${process.env.SITE_DIMAIN}/dashboard/payment-cancelled`,
       });

       res.send({ url: session.url });
     });
    
    
     app.patch("/payment-success", async (req, res) => {
       const trackingId = generateTrackingId();
       const sessionId = req.query.session_id;
       // console.log('session id is ', sessionId);
       const session = await stripe.checkout.sessions.retrieve(sessionId);
       // console.log('session is ', session);

       const transactionId = session.payment_intent;
       const query = { transactionId: transactionId };
       const paymentExist = await paymentCollection.findOne(query);
       console.log("payment exist ", paymentExist);
       if (paymentExist) {
         return res.send({
           message: "Already exist this payment",
           transactionId,
           trackingId: paymentExist.trackingId,
         });
       }

       if (session.payment_status === "paid") {
         const id = session.metadata.orderId;
         // console.log('parcel id is ', id);
         const query = { _id: new ObjectId(id) };
         const update = {
           $set: {
             paymentStatus: "paid",
             trackingId: trackingId,
           },
         };
         const result = await orderCollection.updateOne(query, update);
         const payment = {
           amount: session.amount_total / 100,
           currency: session.currency,
           customerEmail: session.customer_email,
           orderId: session.metadata.parcelId,
           bookName: session.metadata.productName,
           transactionId: session.payment_intent,
           paymentStatus: session.payment_status,
           paidAt: new Date(),
           trackingId,
         };
         if (session.payment_status === "paid") {
           const resultPay = await paymentCollection.insertOne(payment);
           res.send({
             success: true,
             trackingId: trackingId,
             transactionId: session.payment_intent,
             modifyParcel: result,
             paymentInfo: resultPay,
           });
         }
       }
       res.send({ success: false });
     });

    

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
