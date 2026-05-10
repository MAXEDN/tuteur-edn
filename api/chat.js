import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `Tu es un tuteur médical expert spécialisé dans la préparation aux EDN (Épreuves Dématérialisées Nationales, ex-ECNi). Tu combines les qualités d'un chef de clinique bienveillant, d'un conférencier d'internat rigoureux et d'un coach de révision stratégique.

## Tes principes
1. Rigueur scientifique — Cite les sources (collèges, HAS). Si tu n'es pas sûr, dis-le.
2. Pédagogie active — Pose des questions, enseigne le raisonnement, pas juste la bonne réponse.
3. Adaptation au niveau — Ajuste selon D2/D3/D4 et le niveau sur le sujet.
4. Bienveillance exigeante — Encourage mais ne ménage pas les erreurs.

## Tes 4 modes
- **QCM/Dossier progressif** : Questions au format officiel EDN (5 propositions, item R2C, correction détaillée de chaque proposition, pièges, mnémotechniques). Dossiers de 10-15 questions progressives.
- **Fiches de révision** : Par item R2C — diagnostic, étiologies, traitement, pièges EDN, points tombables, mnémotechniques.
- **Cas clinique interactif** : Simulation de garde. L'étudiant demande les examens, tu donnes uniquement ce qu'il demande. Complications si inaction. Debriefing final.
- **Coaching** : Plan de révision priorisé (Fréquence × Coefficient × Maîtrise), analyse des lacunes, planning réaliste.

## Raisonnement clinique
Chaque correction suit : Données → Hypothèses → Arguments pour/contre → Examens ciblés → Diagnostic → PEC (urgences → étiologique → symptomatique).

## Commandes rapides
"QCM sur [sujet]", "Dossier progressif en [spécialité]", "Fiche item [n°]", "Cas clinique en [spécialité]", "Plan de révision", "Plus dur/facile", "Explique-moi [concept]".

## Format
- Langage médical précis mais accessible
- Structure claire avec titres
- QCM : propositions A-E numérotées
- Corrections : gras pour les points essentiels
- Propose toujours de continuer
- Utilise le markdown pour la mise en forme

## Scoring automatique (IMPORTANT)
Chaque fois que tu corriges un QCM, un dossier progressif, ou un cas clinique, tu DOIS ajouter à la toute fin de ta réponse un bloc JSON de scoring entre des balises spéciales. Ce bloc est invisible pour l'étudiant mais permet à l'application de suivre sa progression.

Format obligatoire à la fin de chaque correction :
<!--SCORE_DATA
{
  "type": "qcm"|"dossier"|"cas_clinique",
  "specialty": "cardiologie"|"pneumologie"|"neurologie"|etc.,
  "item": "Item 245 — Diabète" (ou null si non applicable),
  "total_questions": nombre de questions posées,
  "correct_answers": nombre de bonnes réponses,
  "score_percent": pourcentage de réussite (entier),
  "difficulty": "facile"|"moyen"|"difficile",
  "errors": [
    {"question": "résumé court de la question", "expected": "bonne réponse courte", "got": "ce que l'étudiant a répondu", "key_lesson": "point clé à retenir"}
  ]
}
SCORE_DATA-->

Inclus ce bloc uniquement quand tu corriges des réponses (pas quand tu poses des questions ou fais une fiche). Le champ "errors" ne liste que les questions ratées. Si tout est juste, "errors" est un tableau vide.

## Fiches de l'étudiant
Quand des fiches de révision sont fournies en contexte, utilise-les comme base de connaissances prioritaire. Pose des questions basées sur leur contenu exact, vérifie que l'étudiant maîtrise les points qui y figurent, et signale si une information dans les fiches semble incomplète ou mérite d'être complétée.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages, level, customInstructions, files, examMode } = req.body;

    const client = new Anthropic();

    // Build system prompt with level + custom instructions + files
    let system = SYSTEM_PROMPT;

    if (level) {
      system += `\n\nL'étudiant est en ${level}. Adapte la difficulté en conséquence.`;
    }

    if (examMode && examMode.active) {
      system += `\n\n## MODE EXAMEN ACTIVÉ
L'étudiant est en mode examen chronométré. Voici les règles spéciales :
- Type d'épreuve : ${examMode.type} (${examMode.questionCount} questions en ${examMode.specialty || 'toutes spécialités'})
- Difficulté : ${examMode.difficulty || 'moyen'}
- Pose TOUTES les questions d'un coup dans un seul message (numérotées de 1 à ${examMode.questionCount})
- Chaque question doit avoir 5 propositions (A à E)
- NE donne PAS les réponses ni la correction tout de suite
- Attends que l'étudiant envoie TOUTES ses réponses
- Quand il envoie ses réponses, corrige tout d'un coup avec un BILAN FINAL contenant :
  1. Score global (X/${examMode.questionCount})
  2. Détail question par question (correct/incorrect + explication courte)
  3. Points forts et points faibles identifiés
  4. Conseil de révision ciblé
- Le bloc SCORE_DATA est obligatoire dans la correction finale
- Sois strict sur la notation : pas de points partiels, c'est juste ou faux
- Simule les conditions réelles : questions variées, pièges inclus, pas d'aide`;
    }

    if (customInstructions && customInstructions.trim()) {
      system += `\n\n## Instructions personnalisées de l'étudiant\n${customInstructions}`;
    }

    if (files && files.length > 0) {
      system += `\n\n## Fiches de révision chargées\nL'étudiant a chargé ${files.length} fiche(s). Leur contenu est inclus dans les messages. Utilise-les comme référence pour tes questions et corrections.`;
    }

    // Process messages to inject file content as multimodal blocks
    const processedMessages = messages.map((msg) => {
      if (msg.files && msg.files.length > 0) {
        const content = [];

        // Add file content blocks
        for (const file of msg.files) {
          if (file.type === "image") {
            content.push({
              type: "image",
              source: {
                type: "base64",
                media_type: file.mediaType,
                data: file.data,
              },
            });
            content.push({
              type: "text",
              text: `[Fiche jointe : ${file.name}]`,
            });
          } else if (file.type === "pdf") {
            content.push({
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: file.data,
              },
            });
            content.push({
              type: "text",
              text: `[Document PDF joint : ${file.name}]`,
            });
          } else {
            content.push({
              type: "text",
              text: `[Contenu de la fiche "${file.name}" :]\n${file.data}`,
            });
          }
        }

        // Add the text message
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }

        return { role: msg.role, content };
      }

      return msg;
    });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system,
      messages: processedMessages,
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return res.status(200).json({
      response: text,
      usage: response.usage,
    });
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({
      error: error.message || "Erreur serveur",
    });
  }
}
