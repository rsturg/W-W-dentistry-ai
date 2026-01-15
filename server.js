  const express = require('express');
  const axios = require('axios');

  const app = express();
  app.use(express.json());

  // Your settings (these come from Railway environment variables)
  const CAL_API_KEY = process.env.CAL_API_KEY;
  const CAL_EVENT_CLEANING = process.env.CAL_EVENT_CLEANING;
  const CAL_EVENT_EXAM = process.env.CAL_EVENT_EXAM;
  const CAL_EVENT_NEW_PATIENT = process.env.CAL_EVENT_NEW_PATIENT;
  const CAL_EVENT_EMERGENCY = process.env.CAL_EVENT_EMERGENCY;
  const TIMEZONE = process.env.TIMEZONE || 'America/New_York';

  const EVENT_TYPE_MAP = {
    'cleaning': CAL_EVENT_CLEANING,
    'exam': CAL_EVENT_EXAM,
    'new-patient': CAL_EVENT_NEW_PATIENT,
    'new patient': CAL_EVENT_NEW_PATIENT,
    'emergency': CAL_EVENT_EMERGENCY
  };

  // Check availability function
  async function checkAvailability(date, time, appointmentType) {
    const typeKey = appointmentType?.toLowerCase() || 'cleaning';
    const eventTypeId = EVENT_TYPE_MAP[typeKey];

    if (!eventTypeId) {
      return { available: false, message: `I don't have that appointment type. We offer cleanings, exams, new patient visits, and emergency appointments.` };
    }

    try {
      const response = await axios.get('https://api.cal.com/v1/slots', {
        params: {
          apiKey: CAL_API_KEY,
          eventTypeId: eventTypeId,
          startTime: `${date}T00:00:00.000Z`,
          endTime: `${date}T23:59:59.000Z`,
          timeZone: TIMEZONE
        }
      });

      const slotsData = response.data;
      const dateKey = Object.keys(slotsData.slots || {})[0];
      const slots = dateKey ? slotsData.slots[dateKey] : [];

      if (!slots || slots.length === 0) {
        return {
          available: false,
          message: "There's no availability on that date. Would you like to try a different day?"
        };
      }

      // Format available times nicely
      const formattedSlots = slots.slice(0, 4).map(slot => {
        const t = new Date(slot.time);
        return t.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: TIMEZONE
        });
      });

      // If they asked for a specific time
      if (time) {
        const requested = `${date}T${time}:00`;
        const isAvailable = slots.some(slot => slot.time.includes(time));

        if (isAvailable) {
          return {
            available: true,
            message: "That time is available! Can I get your name to book it?"
          };
        } else {
          return {
            available: false,
            message: `That specific time isn't available. I have openings at ${formattedSlots.join(', ')}. Would any of those work?`
          };
        }
      }

      return {
        available: true,
        message: `I have availability at ${formattedSlots.join(', ')}. What time works best for you?`
      };

    } catch (error) {
      console.error('Availability error:', error.response?.data || error.message);
      return {
        available: false,
        message: "I'm having a little trouble checking the schedule. Can I get your name and number and have someone call you back to book?"
      };
    }
  }

  // Book appointment function
  async function bookAppointment(data) {
    const typeKey = data.appointment_type?.toLowerCase() || 'cleaning';
    const eventTypeId = EVENT_TYPE_MAP[typeKey];

    if (!eventTypeId) {
      return { success: false, message: "I couldn't book that type of appointment. Let me take your info and have the office call you." };
    }

    try {
      // Create the booking
      const response = await axios.post('https://api.cal.com/v1/bookings', {
        eventTypeId: parseInt(eventTypeId),
        start: `${data.date}T${data.time}:00.000Z`,
        responses: {
          name: data.name,
          email: data.email || `${data.phone.replace(/\D/g, '')}@noemail.placeholder`,
          phone: data.phone
        },
        timeZone: TIMEZONE,
        language: 'en',
        metadata: {
          source: 'ai-receptionist',
          notes: data.notes || ''
        }
      }, {
        params: { apiKey: CAL_API_KEY }
      });

      // Format confirmation nicely
      const booking = response.data;
      const apptDate = new Date(booking.startTime).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: TIMEZONE
      });
      const apptTime = new Date(booking.startTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: TIMEZONE
      });

      return {
        success: true,
        message: `You're all set! Your ${typeKey} appointment is booked for ${apptDate} at ${apptTime}. We'll see you then!`
      };

    } catch (error) {
      console.error('Booking error:', error.response?.data || error.message);
      return {
        success: false,
        message: "I wasn't able to complete the booking in our system. Let me take your information and have someone call you right back to confirm."
      };
    }
  }

  // Main webhook endpoint
  app.post('/retell', async (req, res) => {
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));

    const { event } = req.body;

    if (event === 'function_call') {
      const functionName = req.body.function_name;
      const args = req.body.arguments || {};

      console.log(`Function: ${functionName}`, args);

      let result;

      if (functionName === 'check_availability') {
        result = await checkAvailability(args.date, args.time, args.appointment_type);
      } else if (functionName === 'book_appointment') {
        result = await bookAppointment(args);
      } else {
        result = { message: "I'll help you with that." };
      }

      console.log('Result:', result);
      return res.json({ result: result.message });
    }

    if (event === 'call_ended') {
      console.log('Call ended:', req.body.call?.from_number);
    }

    res.json({ success: true });
  });

  // Health check
  app.get('/', (req, res) => {
    res.send('Retell Cal.com webhook is running!');
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
