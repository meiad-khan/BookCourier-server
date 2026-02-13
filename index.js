const express = require("express");
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 3000;


app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

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
