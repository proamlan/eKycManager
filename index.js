require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const axios = require("axios");
const morgan = require("morgan");
const UAParser = require("ua-parser-js");

const app = express();
const port = 3000;
const dailyApiKey = process.env.DAILY_API_KEY;
const meetingBaseUrl = process.env.DAILY_BASE_URL;

app.use(bodyParser.json());
app.use(cors());
app.use(morgan("dev"));

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let meetingsCollection;

async function run() {
  try {
    // Connect the client to the server
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
    // Select the database and collection
    const database = client.db("kyc");
    meetingsCollection = database.collection("meetings");
  } catch (error) {
    console.error("Error connecting to MongoDB", error);
  }
}
run().catch(console.dir);

app.post("/submit-details", async (req, res) => {
  const userDetails = req.body;

  try {
    // Check for an available room with fewer than 2 participants
    const availableRoom = await meetingsCollection.findOne({
      $expr: { $lt: [{ $size: "$participants" }, 2] },
    });

    let meeting;
    if (availableRoom) {
      // Add the customer to the available room
      await meetingsCollection.updateOne(
        { _id: availableRoom._id },
        {
          $push: {
            participants: {
              email: userDetails.email,
              device: "unknown",
              browser: "unknown",
            },
          },
        }
      );
      meeting = availableRoom;
    } else {
      // No available room, create a new one
      const agentId = "agent1"; // In a real app, assign dynamically
      const roomName = `room-${generateUniqueId()}`;

      await axios.post(
        "https://api.daily.co/v1/rooms",
        {
          name: roomName,
          properties: {
            enable_chat: true,
            enable_screenshare: true,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${dailyApiKey}`,
          },
        }
      );

      meeting = {
        roomName,
        customerId: userDetails.email,
        agentId,
        startTime: new Date(),
        duration: 0,
        participants: [
          { email: userDetails.email, device: "unknown", browser: "unknown" },
        ],
      };

      await meetingsCollection.insertOne(meeting);
    }

    res.json({
      link: meetingBaseUrl + meeting.roomName,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating or joining meeting room");
  }
});

app.get("/admin/meetings", async (req, res) => {
  try {
    const meetings = await meetingsCollection.find().toArray();
    const detailedMeetings = meetings.map((meeting) => ({
      ...meeting,
      customerWaiting: meeting.participants.length === 1,
    }));
    res.json(detailedMeetings);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching meeting details");
  }
});

app.post("/join-room", async (req, res) => {
  const { roomName, email } = req.body;
  const userAgent = req.headers["user-agent"];
  const parser = new UAParser(userAgent);
  const device = parser.getDevice().type || "Desktop";
  const browser = parser.getBrowser().name;

  try {
    await meetingsCollection.updateOne(
      { roomName, "participants.email": email },
      {
        $set: {
          "participants.$.device": device,
          "participants.$.browser": browser,
        },
      }
    );
    res.status(200).send("Device and browser information updated");
  } catch (error) {
    console.error("Error joining the room", error);
    res.status(500).send("Error joining the room");
  }
});

app.post("/leave-room", async (req, res) => {
  const { roomName, email } = req.body;

  try {
    await meetingsCollection.updateOne(
      { roomName },
      { $pull: { participants: { email } } }
    );
    res.status(200).send("Participant removed from the room");
  } catch (error) {
    console.error("Error leaving the room", error);
    res.status(500).send("Error leaving the room");
  }
});

app.post("/admin/switch-camera", async (req, res) => {
  const { roomName, participantId } = req.body;

  // This is a simplified version and you might need to handle authorization and validation
  try {
    // Send a signal to the participant to switch the camera
    const response = await axios.post(
      `https://api.daily.co/v1/rooms/${roomName}/participants/${participantId}/actions`,
      { action: "switch-camera" },
      {
        headers: {
          Authorization: `Bearer ${dailyApiKey}`,
        },
      }
    );
    res.status(200).send("Switch camera command sent");
  } catch (error) {
    console.error("Error sending switch camera command", error);
    res.status(500).send("Error sending switch camera command");
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

function generateUniqueId() {
  return Math.random().toString(36).substr(2, 9);
}
