import { isMatching, P } from "ts-pattern";
import z from "zod";
import { Agent } from "./Agent";
import { server } from "../server/server";

// --- Mock Implementations ---

const mockWebSearch = async (input: { query: string }) => {
  if (input.query.toLowerCase().includes("us")) {
    return [
      {
        title: "Federal Reserve hints at interest rate cut",
        description: "The Fed signaled a potential rate cut in December.",
      },
      {
        title: "NFL: Chiefs secure playoff spot",
        description: "Patrick Mahomes leads the Kansas City Chiefs to victory.",
      },
    ];
  }
  return [
    {
      title: "Gouvernement annonce un plan de relance",
      description:
        "Le Premier ministre a dévoilé un plan de 10 milliards d'euros.",
    },
    {
      title: "Ligue 1 : le PSG domine l'OM",
      description: "Le Paris Saint-Germain s'impose 3-2 face à l'OM.",
    },
  ];
};

const mockWeather = async (input: { location: string }) => {
  const weatherMap: Record<string, string> = {
    London: "Rainy, 12°C",
    Paris: "Sunny, 18°C",
    "New York": "Cloudy, 15°C",
    Tokyo: "Clear, 22°C",
  };
  return {
    location: input.location,
    forecast: weatherMap[input.location] || "Unknown",
  };
};

const mockStock = async (input: { symbol: string }) => {
  return { symbol: input.symbol, price: 150.0, currency: "USD" };
};

const mockCompanyNews = async (input: { symbol: string }) => {
  return [
    { title: `${input.symbol} releases new product`, sentiment: "positive" },
    { title: `Analyst upgrades ${input.symbol}`, sentiment: "positive" },
  ];
};

// --- Scenarios ---

type Scenario = {
  name: string;
  systemPrompt: string;
  tools: any; // Using any for brevity in definition, properly typed in Agent
  userMessage: string;
};

const scenarios: Scenario[] = [
  {
    name: "1. News Comparison",
    systemPrompt:
      "You are a helpful assistant that can search the web, using the `webSearch` tool.",
    tools: {
      webSearch: {
        description: "Search the web for information",
        parameters: z.object({ query: z.string() }),
        returned: z.array(
          z.object({ title: z.string(), description: z.string() })
        ),
        implementation: mockWebSearch,
      },
    },
    userMessage: "Compare news in france and in the us today",
  },
  {
    name: "2. Weather Forecast",
    systemPrompt:
      "You are a weather assistant. Use `getWeather` to check forecasts.",
    tools: {
      getWeather: {
        description: "Get the current weather for a location",
        parameters: z.object({ location: z.string() }),
        returned: z.object({ location: z.string(), forecast: z.string() }),
        implementation: mockWeather,
      },
    },
    userMessage: "Should I wear a raincoat in London today?",
  },
  {
    name: "3. Stock Analysis",
    systemPrompt:
      "You are a financial analyst. Use `getStockPrice` and `getCompanyNews`.",
    tools: {
      getStockPrice: {
        description: "Get current stock price",
        parameters: z.object({ symbol: z.string() }),
        returned: z.object({
          symbol: z.string(),
          price: z.number(),
          currency: z.string(),
        }),
        implementation: mockStock,
      },
      getCompanyNews: {
        description: "Get recent news for a company",
        parameters: z.object({ symbol: z.string() }),
        returned: z.array(
          z.object({ title: z.string(), sentiment: z.string() })
        ),
        implementation: mockCompanyNews,
      },
    },
    userMessage:
      "Analyze Apple's (AAPL) stock performance based on recent news.",
  },
  {
    name: "4. Recipe Finder",
    systemPrompt: "You are a chef. Help users find recipes.",
    tools: {
      searchRecipes: {
        description: "Search for recipes by keyword",
        parameters: z.object({ query: z.string() }),
        returned: z.array(z.string()),
        implementation: async ({ query }: { query: string }) =>
          [
            "Spaghetti Carbonara",
            "Chicken Alfredo",
            "Vegetable Stir Fry",
          ].filter(
            (r) =>
              r.toLowerCase().includes(query.toLowerCase()) ||
              query === "dinner"
          ),
      },
      getRecipeDetails: {
        description: "Get details for a specific recipe",
        parameters: z.object({ name: z.string() }),
        returned: z.object({
          ingredients: z.array(z.string()),
          time: z.string(),
        }),
        implementation: async ({ name }: { name: string }) => ({
          ingredients: ["pasta", "eggs", "bacon"],
          time: "30 mins",
        }),
      },
    },
    userMessage: "Find me a dinner recipe and tell me the ingredients.",
  },
  {
    name: "5. Trip Planning",
    systemPrompt: "You are a travel agent. Plan trips using available tools.",
    tools: {
      flightSearch: {
        description: "Search for flights",
        parameters: z.object({ from: z.string(), to: z.string() }),
        returned: z.array(z.string()),
        implementation: async ({ from, to }: { from: string; to: string }) => [
          `Flight ${from} -> ${to} at 10:00 AM`,
          `Flight ${from} -> ${to} at 2:00 PM`,
        ],
      },
      hotelSearch: {
        description: "Search for hotels",
        parameters: z.object({ location: z.string() }),
        returned: z.array(z.string()),
        implementation: async ({ location }: { location: string }) => [
          `Grand Hotel ${location}`,
          `Cozy Inn ${location}`,
        ],
      },
    },
    userMessage:
      "Plan a trip from Paris to New York. Find flights and a hotel.",
  },
  {
    name: "6. Email Assistant",
    systemPrompt: "You are an email assistant. Manage user emails.",
    tools: {
      readEmails: {
        description: "Read unread emails",
        parameters: z.object({}),
        returned: z.array(
          z.object({ from: z.string(), subject: z.string(), body: z.string() })
        ),
        implementation: async () => [
          {
            from: "boss@company.com",
            subject: "Urgent",
            body: "Please send the report.",
          },
        ],
      },
      sendEmail: {
        description: "Send an email",
        parameters: z.object({ to: z.string(), body: z.string() }),
        returned: z.string(),
        implementation: async ({ to }: { to: string }) => `Email sent to ${to}`,
      },
    },
    userMessage:
      "Check my emails and if there is anything urgent from my boss, reply to it.",
  },
  {
    name: "7. Code Reviewer",
    systemPrompt: "You are a senior developer. Review code.",
    tools: {
      readCode: {
        description: "Read file content",
        parameters: z.object({ filepath: z.string() }),
        returned: z.string(),
        implementation: async ({ filepath }: { filepath: string }) =>
          `console.log("Hello world");\n var x = 1;`,
      },
      runLinter: {
        description: "Run linter on a file",
        parameters: z.object({ filepath: z.string() }),
        returned: z.array(z.string()),
        implementation: async () => [
          "Warning: 'var' is deprecated, use 'let' or 'const'",
        ],
      },
    },
    userMessage: "Review the code in 'src/main.ts'.",
  },
  {
    name: "8. Product Comparison",
    systemPrompt: "You are a tech expert. Compare products.",
    tools: {
      searchProducts: {
        description: "Search for products",
        parameters: z.object({ query: z.string() }),
        returned: z.array(z.object({ name: z.string(), price: z.number() })),
        implementation: async ({ query }: { query: string }) => [
          { name: "Phone X", price: 999 },
          { name: "Phone Y", price: 899 },
        ],
      },
      compareSpecs: {
        description: "Compare specifications of two products",
        parameters: z.object({ product1: z.string(), product2: z.string() }),
        returned: z.string(),
        implementation: async ({ product1, product2 }: any) =>
          `${product1} has better battery, ${product2} has better camera.`,
      },
    },
    userMessage: "Compare Phone X and Phone Y.",
  },
  {
    name: "9. Calendar Management",
    systemPrompt: "You are a scheduling assistant.",
    tools: {
      getEvents: {
        description: "Get today's events",
        parameters: z.object({ date: z.string() }),
        returned: z.array(z.object({ title: z.string(), time: z.string() })),
        implementation: async () => [
          { title: "Team Meeting", time: "10:00 AM" },
        ],
      },
      scheduleEvent: {
        description: "Schedule a new event",
        parameters: z.object({ title: z.string(), time: z.string() }),
        returned: z.string(),
        implementation: async ({ title, time }: any) =>
          `Scheduled ${title} at ${time}`,
      },
    },
    userMessage: "What do I have today? Also schedule lunch at 12 PM.",
  },
  {
    name: "10. Translation Service",
    systemPrompt: "You are a polyglot translator.",
    tools: {
      translate: {
        description: "Translate text to a target language",
        parameters: z.object({ text: z.string(), targetLang: z.string() }),
        returned: z.string(),
        implementation: async ({ text, targetLang }: any) =>
          `[${targetLang}] ${text}`,
      },
    },
    userMessage: "Translate 'Hello World' into French, Spanish, and German.",
  },
  {
    name: "11. Crisis Management (Multi-tool)",
    systemPrompt: "You are a crisis manager. Monitor news and emails.",
    tools: {
      webSearch: {
        description: "Search the web",
        parameters: z.object({ query: z.string() }),
        returned: z.array(
          z.object({ title: z.string(), description: z.string() })
        ),
        implementation: mockWebSearch,
      },
      readEmails: {
        description: "Read emails",
        parameters: z.object({}),
        returned: z.array(
          z.object({ from: z.string(), subject: z.string(), body: z.string() })
        ),
        implementation: async () => [
          {
            from: "security@corp.com",
            subject: "Alert",
            body: "Possible data breach detected.",
          },
        ],
      },
      sendEmail: {
        description: "Send email",
        parameters: z.object({ to: z.string(), body: z.string() }),
        returned: z.string(),
        implementation: async ({ to }: { to: string }) => `Email sent to ${to}`,
      },
    },
    userMessage:
      "Check news and emails for 'Data Breach'. If confirmed, draft a response to the board.",
  },
  {
    name: "12. Travel & Meeting (Multi-tool)",
    systemPrompt: "You are an executive assistant. Manage travel and schedule.",
    tools: {
      flightSearch: {
        description: "Search flights",
        parameters: z.object({ from: z.string(), to: z.string() }),
        returned: z.array(z.string()),
        implementation: async ({ from, to }: any) => [
          `Flight ${from}->${to} 08:00`,
        ],
      },
      getEvents: {
        description: "Get schedule",
        parameters: z.object({ date: z.string() }),
        returned: z.array(z.object({ title: z.string(), time: z.string() })),
        implementation: async () => [
          { title: "Weekly Sync", time: "09:00 AM" },
        ],
      },
      rescheduleEvent: {
        description: "Reschedule an event",
        parameters: z.object({ title: z.string(), newTime: z.string() }),
        returned: z.string(),
        implementation: async ({ title, newTime }: any) =>
          `Rescheduled ${title} to ${newTime}`,
      },
      webSearch: {
        description: "Search local info",
        parameters: z.object({ query: z.string() }),
        returned: z.array(z.string()),
        implementation: async () => ["Top rated: The Ivy, Dishoom"],
      },
    },
    userMessage:
      "I need to fly London -> NY tomorrow morning. Check for flight conflicts with my schedule, reschedule if needed, and find a dinner spot in NY.",
  },
  {
    name: "13. Investment Research (Multi-tool)",
    systemPrompt:
      "You are a global investment analyst. Aggregate data from multiple sources.",
    tools: {
      webSearch: {
        description: "Search web",
        parameters: z.object({ query: z.string() }),
        returned: z.array(
          z.object({ title: z.string(), description: z.string() })
        ),
        implementation: async () => [
          {
            title: "Siemens Energy expands",
            description: "German renewable sector growing.",
          },
        ],
      },
      translate: {
        description: "Translate text",
        parameters: z.object({ text: z.string(), targetLang: z.string() }),
        returned: z.string(),
        implementation: async ({ text }: any) => `[Translated] ${text}`,
      },
      getStockPrice: {
        description: "Get stock price",
        parameters: z.object({ symbol: z.string() }),
        returned: z.object({ price: z.number() }),
        implementation: async () => ({ price: 120.5 }),
      },
    },
    userMessage:
      "Search for renewable energy news in Germany, translate summaries to English, and check stock price of mentioned companies.",
  },
];

export async function client() {
  const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];

  console.log(`\n--- Running Scenario: ${scenario.name} ---\n`);
  console.log(`User: "${scenario.userMessage}"\n`);

  const agent = new Agent(
    scenario.systemPrompt,
    scenario.tools,
    (messages, tools) => {
      return server(messages, tools);
    }
  );

  const result = await agent.run([
    {
      role: "user",
      content: scenario.userMessage,
    },
  ]);

  console.log("\n--- Final Result ---\n");
  console.log(JSON.stringify(result, null, 2));
}
