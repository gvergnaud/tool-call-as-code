import { isMatching, P } from "ts-pattern";
import z from "zod";
import { Agent } from "./Agent";

// In a real-world implementation this would be an HTTP call.
import { server } from "../server/server";

export async function client() {
  const agent = new Agent(
    "You are a helpful assistant that can search the web, using the `webSearch` tool.",
    {
      webSearch: {
        description: "Search the web for information",
        parameters: z.object({ query: z.string() }),
        returned: z.array(z.object({ title: z.string(), url: z.string() })),
        implementation: async (input) => {
          if (
            isMatching(
              { query: P.string.includes("US").or(P.string.includes("us")) },
              input
            )
          ) {
            return [
              {
                title:
                  "Federal Reserve hints at interest rate cut amid economic slowdown",
                description:
                  "The Fed signaled a potential rate cut in December as inflation cools and unemployment rises. Analysts warn of a possible recession if consumer spending continues to decline.",
              },
              {
                title:
                  "NFL: Chiefs secure playoff spot with thrilling overtime win",
                description:
                  "Patrick Mahomes leads the Kansas City Chiefs to a 27-24 victory over the Ravens, securing their fifth consecutive playoff berth. The game-winning drive included a 45-yard pass to Travis Kelce.",
              },
              {
                title: "California wildfires force thousands to evacuate",
                description:
                  "Dozens of homes have been destroyed as wildfires rage across Northern California. Firefighters battle extreme winds and dry conditions, with containment efforts expected to take weeks.",
              },
            ];
          }

          return [
            {
              title:
                "Gouvernement annonce un plan de relance pour les énergies renouvelables",
              description:
                "Le Premier ministre a dévoilé ce matin un plan de 10 milliards d'euros pour accélérer la transition énergétique, avec un focus sur l'éolien et le solaire. Les objectifs visent une réduction de 50 % des émissions de CO₂ d'ici 2030.",
            },
            {
              title: "Ligue 1 : le PSG domine l'OM dans un Classique tendu",
              description:
                "Le Paris Saint-Germain s'impose 3-2 face à l'Olympique de Marseille lors d'un match riche en rebondissements. Mbappé marque un doublé et confirme sa forme éclatante à quelques semaines de la Coupe du Monde des Clubs.",
            },
            {
              title:
                "Grèves dans les transports : la SNCF et la RATP appellent au dialogue",
              description:
                "Une nouvelle journée de grève perturbe les transports en Île-de-France ce lundi. Les syndicats réclament des hausses de salaire et de meilleures conditions de travail, tandis que le gouvernement propose une médiation.",
            },
          ];
        },
      },
    },
    (messages, tools) => {
      return server(messages, tools);
    }
  );
  const result = await agent.run([
    {
      role: "user",
      content: "Compare news in france and in the us today",
      // "Look for sport news and international affaires news in parallel and give me all results.",
    },
  ]);

  console.log(JSON.stringify(result, null, 2));
}
