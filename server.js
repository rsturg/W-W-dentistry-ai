const express = require('express');
  const axios = require('axios');

  const app = express();
  app.use(express.json());

  // CLIENT DATABASE
  // For now, store configs here. Later, move to Supabase or Google Sheets.
  const CLIENTS = {
    // Key = Retell agent_id (find in Retell dashboard)
    "agent_abc123xyz": {
      name: "Wright and Wheeler Dentistry",
      calApiKey: "cal_live_xxxxxxxxxxxx",
      timezone: "America/New_York",
      eventTypes: {
        "cleaning": "111111",
        "exam": "111112",
        "new-patient": "111113",
        "emergency": "111114"
      }
    },
    "agent_def456abc": {
      name: "Smile Dental Studio",
      calApiKey: "cal_live_yyyyyyyyyyyy",
      timezone: "America/Chicago",
      eventTypes: {
        "cleaning": "222221",
        "exam": "222222",
        "new-patient": "222223",
        "emergency": "222224"
      }
    }
    // Add more clients here
  };

  // Get client config from agent ID
  function getClient(agentId) {
    const client = CLIENTS[agentId];
    if (!client) {
      console.error(`Unknown client for agent: ${agentId}`);
      return null;
    }
    return client;
  }

  // Check availability
  async function checkAvailability(client, date, time, appointmentType) {
    const typeKey = appointmentType?.toLowerCase() || 'cleaning';
    const eventTypeId = client.eventTypes[typeKey];

    if (!eventTypeId) {
      return { message: "We offer cleanings, exams, new patient visits, and emergency appointments. Which would you like?" };
    }

    try {
      const response = await axios.get('https://api.cal.com/v1/slots', {
        params: {
          apiKey: client.calApiKey,
          eventTypeId: eventTypeId,
          startTime: `${date}T00:00:00.000Z`,
          endTime: `${date}T23:59:59.000Z`,
          timeZone: client.timezone
        }
      });

      const slotsData = response.data;
      const dateKey = Object.keys(slotsData.slots || {})[0];
      const slots = dateKey ? slotsData.slots[dateKey] : [];

      if (!slots || slots.length === 0) {
        return { message: "There's no availability on that date. Would you like to try a different day?" };
      }

      const formattedSlots = slots.slice(0, 4).map(slot => {
        return new Date(slot.time).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: client.timezone
        });
      });

      if (time) {
        const isAvailable = slots.some(slot => slot.time.includes(time));
        if (isAvailable) {
          return { message: "That time is available! Can I get your name to book it?" };
        } else {
          return { message: `That time isn't available. I have openings at ${formattedSlots.join(', ')}. Would any of those work?` };
        }
      }

      return { message: `I have availability at ${formattedSlots.join(', ')}. What time works best for you?` };

    } catch (error) {
      console.error('Availability error:', error.response?.data || error.message);
      return { message: "I'm having trouble checking the schedule. Can I get your info and have someone call you back?" };
    }
  }

  // Book appointment
  async function bookAppointment(client, data) {
    const typeKey = data.appointment_type?.toLowerCase() || 'cleaning';
    const eventTypeId = client.eventTypes[typeKey];

    if (!eventTypeId) {
      return { message: "Let me take your information and have the office call you to book." };
    }

    try {
      const response = await axios.post('https://api.cal.com/v1/bookings', {
        eventTypeId: parseInt(eventTypeId),
        start: `${data.date}T${data.time}:00.000Z`,
        responses: {
          name: data.name,
          email: data.email || `${data.phone.replace(/\D/g, '')}@noemail.placeholder`,
          phone: data.phone
        },
        timeZone: client.timezone,
        language: 'en',
        metadata: {
          source: 'ai-receptionist',
          notes: data.notes || ''
        }
      }, {
        params: { apiKey: client.calApiKey }
      });

      const booking = response.data;
      const apptDate = new Date(booking.startTime).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: client.timezone
      });
      const apptTime = new Date(booking.startTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: client.timezone
      });

      return { message: `You're all set! Your ${typeKey} appointment is booked for ${apptDate} at ${apptTime}. We'll see you then!` };

    } catch (error) {
      console.error('Booking error:', error.response?.data || error.message);
      return { message: "I couldn't complete the booking. Let me take your info and have someone call you to confirm." };
    }
  }

  // Main webhook - handles ALL clients
  app.post('/retell', async (req, res) => {
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));

    const { event, call } = req.body;
    const agentId = call?.agent_id;

    // Get client config
    const client = getClient(agentId);
    if (!client) {
      console.error('No client found for agent:', agentId);
      return res.json({ result: "I'm having a technical issue. Please call back in a few minutes." });
    }

    console.log(`Processing call for: ${client.name}`);

    if (event === 'function_call') {
      const functionName = req.body.function_name;
      const args = req.body.arguments || {};

      let result;

      if (functionName === 'check_availability') {
        result = await checkAvailability(client, args.date, args.time, args.appointment_type);
      } else if (functionName === 'book_appointment') {
        result = await bookAppointment(client, args);
      } else {
        result = { message: "I'll help you with that." };
      }

      return res.json({ result: result.message });
    }

    res.json({ success: true });
  });

  app.get('/', (req, res) => {
    res.send(`Multi-client webhook running. Managing ${Object.keys(CLIENTS).length} clients.`);
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
