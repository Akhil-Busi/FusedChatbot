# FusedChatbot/server/ai_core_service/llm_handler.py
import os
import logging
from dotenv import load_dotenv

# --- SDK Imports with Graceful Fallbacks ---
try:
    import google.generativeai as genai
except ImportError:
    genai = None
    logging.warning("SDK not found: 'google.generativeai'. Gemini features will be unavailable.")

try:
    from groq import Groq
except ImportError:
    Groq = None
    logging.warning("SDK not found: 'groq'. Groq features will be unavailable.")

try:
    from langchain_ollama import ChatOllama
except ImportError:
    ChatOllama = None
    logging.warning("SDK not found: 'langchain_ollama'. Ollama features will be unavailable.")
try:
    from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
except ImportError:
    HumanMessage, SystemMessage, AIMessage = None, None, None
    logging.warning("Langchain core messages not found. Ollama functionality may be affected.")
try:
    from langchain.prompts import PromptTemplate
except ImportError:
    PromptTemplate = None
    logging.warning("Langchain PromptTemplate not found; analysis prompts will use string formatting.")

# --- Service Configuration ---
try:
    from . import config as service_config
except ImportError:
    import config as service_config

dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=dotenv_path)

logger = logging.getLogger(__name__)


# --- Prompt Templates ---

_ANALYSIS_THINKING_PREFIX_STR = """**STEP 1: THINKING PROCESS (Recommended):**
*   Before generating the analysis, briefly outline your plan in `<thinking>` tags. Example: `<thinking>Analyzing for FAQs. Will scan for key questions and answers presented in the text.</thinking>`
*   If you include thinking, place the final analysis *after* the `</thinking>` tag.

**STEP 2: ANALYSIS OUTPUT:**
*   Generate the requested analysis based **strictly** on the text provided below.
*   Follow the specific OUTPUT FORMAT instructions carefully.

--- START DOCUMENT TEXT ---
{doc_text_for_llm}
--- END DOCUMENT TEXT ---
"""

if PromptTemplate:
    ANALYSIS_PROMPTS = {
        "faq": PromptTemplate(
            input_variables=["doc_text_for_llm", "num_items"],
            template=_ANALYSIS_THINKING_PREFIX_STR + """
**TASK:** Generate approximately {num_items} Frequently Asked Questions (FAQs) with concise answers based ONLY on the text. The number should be appropriate for the document's length and detail.
**OUTPUT FORMAT (Strict):**
*   Start directly with the first FAQ (after thinking, if used). Do **NOT** include preamble.
*   Format each FAQ as: `Q: [Question derived ONLY from the text]\nA: [Answer derived ONLY from the text, concise]`
*   If the text doesn't support an answer, don't invent one.
**BEGIN OUTPUT (Start with 'Q:' or `<thinking>`):**
"""
        ),
        "topics": PromptTemplate(
            input_variables=["doc_text_for_llm", "num_items"],
            template=_ANALYSIS_THINKING_PREFIX_STR + """
**TASK:** Identify approximately {num_items} most important topics discussed. Provide a 1-2 sentence explanation per topic based ONLY on the text. The number should be appropriate for the document's length and detail.
**OUTPUT FORMAT (Strict):**
*   Start directly with the first topic (after thinking, if used). Do **NOT** include preamble.
*   Format as a Markdown bulleted list: `*   **Topic Name:** Brief explanation derived ONLY from the text content (1-2 sentences max).`
**BEGIN OUTPUT (Start with '*   **' or `<thinking>`):**
"""
        ),
        # --- REPLACE THE MINDMAP PROMPT WITH THIS NEW, STRONGER VERSION ---
        "mindmap": PromptTemplate(
            input_variables=["doc_text_for_llm"],
            template="""You are a text-to-Mermaid-syntax converter. Your ONLY job is to create a mind map from the user's text.

**CRITICAL INSTRUCTIONS:**
1.  **TOP-LEVEL DECLARATION:** The entire output MUST begin with the single word `mindmap` on the first line. NO other text, preamble, or explanation should come before it.
2.  **HIERARCHY:** Use indentation to show hierarchy. More indentation means a deeper level in the mind map.
3.  **NO MARKDOWN:** Do NOT use Markdown characters like `-`, `*`, or `#`.
4.  **CONCISENESS:** Keep node text brief and to the point.

**STRICT OUTPUT EXAMPLE:**
mindmap
  Main Idea
    Key Concept A
      Detail 1
      Detail 2
    Key Concept B
    Key Concept C
      Detail 3

--- START DOCUMENT TEXT ---
{doc_text_for_llm}
--- END DOCUMENT TEXT ---

Based on the text, generate the Mermaid mind map syntax now.
"""
        ),
        # --- END OF REPLACEMENT ---
    }
    logger.info("ANALYSIS_PROMPTS initialized using Langchain PromptTemplate objects.")
else:
    # Fallback to plain f-strings if Langchain is not available
    ANALYSIS_PROMPTS = {
        "faq": _ANALYSIS_THINKING_PREFIX_STR + "**TASK:** Generate approximately {num_items} FAQs...",
        "topics": _ANALYSIS_THINKING_PREFIX_STR + "**TASK:** Identify approximately {num_items} topics...",
        "mindmap": _ANALYSIS_THINKING_PREFIX_STR + "**TASK:** Generate a mind map...",
    }
    logger.warning("ANALYSIS_PROMPTS stored as strings. Manual formatting will be used.")


_SYNTHESIS_PROMPT_TEMPLATE_STR = """You are a faculty member for engineering students with in-depth knowledge in all engineering subjects and am Expert for an academic audience, ranging from undergraduates to PhD scholars. Your goal is to answer the user's query based on the provided context document chunks, augmented with your general knowledge when necessary. You have to Provide detailed, technical, and well-structured responses suitable for this audience. Use precise terminology, include relevant concepts, algorithms, and applications, and organize your response with sections or bullet points where appropriate.

**TASK:** Respond to the user's query using the provided context and your general knowledge.

**USER QUERY:**
"{query}"

**PROVIDED CONTEXT:**
--- START CONTEXT ---
{context}
--- END CONTEXT ---

**INSTRUCTIONS & OUTPUT STRUCTURE:**

**1. THINKING PROCESS (MANDATORY):**
*   **CRITICAL:** Before providing the final answer, first articulate your step-by-step reasoning process. Explain how you will use the context and potentially supplement it with general knowledge to address the user's query.
*   Use a detailed Chain of Thought (CoT) approach.
*   Enclose this entire reasoning process *exclusively* within `<thinking>` and `</thinking>` tags.
*   Example: `<thinking>The user's query is about X. Context [1] defines X. Context [3] gives an example Z. Context [2] seems less relevant for aspect A of the query but might be useful for aspect B. The context doesn't cover Y, so I will synthesize information from [1] and [3] for X and aspect A, then add general knowledge about Y, clearly indicating it's external information for that part.</thinking>`
*   **DO NOT** put any text before the opening `<thinking>` tag or after the closing `</thinking>` tag *except for the final answer*.

**2. FINAL ANSWER (MANDATORY, *AFTER* the `</thinking>` tag):**
*   After the closing `</thinking>` tag, provide your comprehensive and helpful final answer to the user query.
*   **Prioritize Context:** Base your answer **primarily** on information found within the `PROVIDED CONTEXT`.
*   **Cite Sources:** When using information *directly* from a context chunk, **you MUST cite** its number like [1], [2], or [1][3]. Cite all relevant sources for each piece of information derived from the context.
*   **Insufficient Context:** If the context does not contain information needed for a full answer, explicitly state what is missing (e.g., "The provided documents don't detail the specific algorithm used for X...").
*   **Integrate General Knowledge:** You may *seamlessly integrate* your general knowledge to fill gaps, provide background, or offer broader explanations, but do so **after** thoroughly utilizing the context. Clearly signal when you are predominantly using general knowledge if it's a significant portion of an answer point (e.g., "Generally speaking, outside of the provided documents...", "From broader engineering principles...").
*   **Be a Tutor:** Explain concepts clearly. Be helpful, accurate, and use a professional, academic tone. Use Markdown formatting (lists, bolding, code blocks) for readability and structure.
*   **Accuracy:** Do not invent information not present in the context or verifiable general knowledge. If unsure, state that.

**BEGIN RESPONSE (The entire response must start with the `<thinking>` tag and then the final answer):**
"""

_SUB_QUERY_TEMPLATE_STR = """You are an AI assistant skilled at decomposing user questions into effective search queries for a vector database.
Given the user's query, generate {num_queries} distinct search queries targeting different specific aspects, keywords, or concepts within the original query.
Focus on creating queries that are likely to retrieve relevant text chunks individually.
Output ONLY the generated search queries, each on a new line. Do not include numbering, labels, explanations, or any other text.

User Query: "{query}"

Generated Search Queries:"""


# --- LLM Provider Configurations ---

# We no longer configure clients globally with environment variables.
# Keys will be passed in with each request.
# The environment variables can serve as a fallback or for other parts of the system if needed.
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-1.5-flash")
DEFAULT_GEMINI_GENERATION_CONFIG = {"temperature": 0.7, "max_output_tokens": 4096}
DEFAULT_GEMINI_SAFETY_SETTINGS = [
    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_ONLY_HIGH"},
    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_ONLY_HIGH"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_ONLY_HIGH"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_ONLY_HIGH"},
]
logger.info("LLM Handler initialized. API clients will be created per-request.")

# Ollama configuration remains the same as it doesn't use API keys
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
DEFAULT_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
ollama_available = bool(ChatOllama and HumanMessage)

# Default Groq model name
DEFAULT_GROQ_LLAMA3_MODEL = os.getenv("GROQ_LLAMA3_MODEL", "llama3-8b-8192")


# --- Helper Functions ---

def _parse_thinking_and_answer(full_llm_response: str) -> tuple[str, str | None]:
    """Parses an LLM response to separate the <thinking> block from the final answer."""
    response_text = full_llm_response.strip()
    think_start_tag, think_end_tag = "<thinking>", "</thinking>"
    start_index = response_text.find(think_start_tag)
    end_index = response_text.find(think_end_tag, start_index)
    if start_index != -1:
        if end_index != -1:
            thinking_content = response_text[start_index + len(think_start_tag):end_index].strip()
            answer = response_text[end_index + len(think_end_tag):].strip()
        else:
            logger.warning("Found '<thinking>' tag but no closing tag.")
            thinking_content = response_text[start_index + len(think_start_tag):].strip()
            answer = "[AI response seems to be a thinking process only or was truncated.]"
        if not answer and thinking_content:
            answer = "[AI response primarily contained reasoning. See thinking process for details.]"
        return answer, thinking_content
    if not response_text:
        return "[AI provided an empty response.]", None
    return response_text, None


def _call_llm_for_task(prompt: str, llm_provider: str, llm_model_name: str = None, user_gemini_api_key: str = None, user_grok_api_key: str = None) -> str:
    """Internal helper to dispatch a simple, single-prompt task to an LLM using per-request keys."""
    if llm_provider.startswith("gemini"):
        if not genai: raise ConnectionError("Gemini SDK not installed.")
        if not user_gemini_api_key: raise ConnectionError("User Gemini API key is required but was not provided.")
        # The Gemini SDK uses a global configuration. This is not ideal for concurrency but is the library's standard.
        genai.configure(api_key=user_gemini_api_key)
        model = genai.GenerativeModel(llm_model_name or GEMINI_MODEL_NAME)
        response = model.generate_content(prompt)
        return response.text
    
    elif llm_provider.startswith("groq"):
        if not Groq: raise ConnectionError("Groq SDK not installed.")
        if not user_grok_api_key: raise ConnectionError("User Groq API key is required but was not provided.")
        # Create a client instance for this specific request
        local_groq_client = Groq(api_key=user_grok_api_key)
        completion = local_groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=llm_model_name or DEFAULT_GROQ_LLAMA3_MODEL
        )
        return completion.choices[0].message.content
        
    elif llm_provider == "ollama":
        if not ollama_available: raise ConnectionError("Ollama dependencies not available.")
        ollama_llm = ChatOllama(base_url=OLLAMA_BASE_URL, model=llm_model_name or DEFAULT_OLLAMA_MODEL)
        response = ollama_llm.invoke([HumanMessage(content=prompt)])
        return response.content
        
    else:
        raise ValueError(f"Unsupported LLM provider: {llm_provider}")


# --- Core AI Functions ---

def perform_document_analysis(document_text: str,
                              analysis_type: str,
                              llm_provider: str,
                              llm_model_name: str = None,
                              user_gemini_api_key: str = None,
                              user_grok_api_key: str = None) -> tuple[str | None, str | None]:
    """Performs analysis on a document using per-request API keys."""
    logger.info(f"Performing '{analysis_type}' analysis with {llm_provider}.")
    if not document_text.strip():
        logger.warning("Document analysis cancelled: input text is empty.")
        return "Error: Document content is empty, cannot perform analysis.", None

    # 1. Truncate document text if it exceeds the configured limit
    max_len = service_config.ANALYSIS_MAX_CONTEXT_LENGTH
    original_length = len(document_text)
    doc_text_for_llm = document_text[:max_len] if original_length > max_len else document_text
    if original_length > max_len:
        logger.warning(f"Document ({original_length} chars) was truncated to {max_len} chars.")
        doc_text_for_llm += "\n\n... [CONTENT TRUNCATED FOR ANALYSIS]"

    # 2. Dynamically determine the number of items for certain analyses
    if original_length <= 500:
        num_items = 3
    else:
        base_items, max_items = 5, 20
        additional_items = (original_length // 4000)  # +1 item per ~4k chars
        num_items = min(base_items + additional_items, max_items)
    logger.info(f"Targeting ~{num_items} items for '{analysis_type}' based on document length.")

    # 3. Prepare the prompt
    prompt_obj = ANALYSIS_PROMPTS.get(analysis_type)
    if not prompt_obj:
        logger.error(f"Invalid analysis type '{analysis_type}'.")
        return f"Error: Analysis type '{analysis_type}' is not supported.", None

    try:
        format_args = {"doc_text_for_llm": doc_text_for_llm}
        if analysis_type in ["faq", "topics"]:
            format_args["num_items"] = num_items
        final_prompt_str = prompt_obj.format(**format_args)
    except (KeyError, TypeError) as e:
        logger.error(f"Prompt for '{analysis_type}' failed to format: {e}", exc_info=True)
        return f"Error: Internal prompt configuration issue for {analysis_type}.", None

    logger.debug(f"Analysis prompt (start): {final_prompt_str[:300]}...")

    # 4. Call the appropriate LLM provider and parse the response
    try:
        raw_response = _call_llm_for_task(
            prompt=final_prompt_str,
            llm_provider=llm_provider,
            llm_model_name=llm_model_name,
            user_gemini_api_key=user_gemini_api_key,
            user_grok_api_key=user_grok_api_key
        )
        logger.info(f"Successfully received analysis from {llm_provider}.")
        # For the new mindmap prompt, we should NOT parse for thinking, as it's been explicitly removed.
        if analysis_type == 'mindmap':
            return raw_response.strip(), None
        return _parse_thinking_and_answer(raw_response)
    except Exception as e:
        logger.error(f"Error during '{analysis_type}' analysis with {llm_provider}: {e}", exc_info=True)
        return "Error performing document analysis: An API or system error occurred.", None


def generate_sub_queries_via_llm(original_query: str,
                                 llm_provider: str,
                                 llm_model_name: str = None,
                                 num_sub_queries: int = 3,
                                 user_gemini_api_key: str = None,
                                 user_grok_api_key: str = None) -> list[str]:
    """Decomposes a query using per-request API keys."""
    if num_sub_queries <= 0: return []
    prompt = _SUB_QUERY_TEMPLATE_STR.format(query=original_query, num_queries=num_sub_queries)
    logger.info(f"Generating {num_sub_queries} sub-queries with {llm_provider}.")

    try:
        raw_response = _call_llm_for_task(
            prompt=prompt,
            llm_provider=llm_provider,
            llm_model_name=llm_model_name,
            user_gemini_api_key=user_gemini_api_key,
            user_grok_api_key=user_grok_api_key
        )
        sub_queries = [q.strip() for q in raw_response.strip().split('\n') if q.strip()]
        logger.info(f"Successfully generated {len(sub_queries)} sub-queries.")
        return sub_queries[:num_sub_queries]
    except Exception as e:
        logger.error(f"Failed to generate sub-queries with {llm_provider}: {e}", exc_info=True)
        return []


# --- Main Response Synthesis Functions ---

def get_gemini_response(query: str, context_text: str, model_name: str = None, user_gemini_api_key: str = None, chat_history: list = None, system_prompt: str = None, **kwargs) -> tuple[str, str | None]:
    if not genai: raise ConnectionError("Gemini SDK not installed.")
    if not user_gemini_api_key: raise ConnectionError("User Gemini API key is required but was not provided.")
    genai.configure(api_key=user_gemini_api_key)
    
    final_user_prompt = _SYNTHESIS_PROMPT_TEMPLATE_STR.format(query=query, context=context_text)

    # --- MODIFICATION START: Build conversation history for the API call ---
    model_kwargs = {
        "generation_config": DEFAULT_GEMINI_GENERATION_CONFIG,
        "safety_settings": DEFAULT_GEMINI_SAFETY_SETTINGS
    }
    if system_prompt:
        model_kwargs["system_instruction"] = system_prompt

    model = genai.GenerativeModel(model_name or GEMINI_MODEL_NAME, **model_kwargs)

    # Convert your history format to Gemini's format
    history_for_api = []
    if chat_history:
        for message in chat_history:
            role = "user" if message.get("role") == "user" else "model"
            # Ensure parts is a list and has text
            text_part = message.get("parts", [{}])[0].get("text", "")
            if text_part:
                history_for_api.append({'role': role, 'parts': [text_part]})

    # Start a chat session with the history
    chat_session = model.start_chat(history=history_for_api)
    logger.info(f"Calling Gemini for synthesis (Model: {model.model_name}) with {len(history_for_api)} history messages.")
    # --- MODIFICATION END ---
    
    try:
        # Send the final user message to the chat session
        response = chat_session.send_message(final_user_prompt)

        if (candidate := response.candidates[0] if response.candidates else None) and \
           (candidate.finish_reason.name not in ["STOP", "MAX_TOKENS"]):
            logger.warning(f"Gemini response terminated unexpectedly. Reason: {candidate.finish_reason.name}")
        return _parse_thinking_and_answer(response.text)
    except Exception as e:
        logger.error(f"Gemini API call failed during synthesis: {e}", exc_info=True)
        # Check for specific authentication errors from Gemini
        if 'API_KEY_INVALID' in str(e):
            raise ConnectionError("The provided Gemini API key is invalid.")
        raise ConnectionError("Failed to get response from Gemini.") from e

def get_ollama_response(query: str, context_text: str, model_name: str = None, chat_history: list = None, system_prompt: str = None, **kwargs) -> tuple[str, str | None]:
    if not ollama_available: raise ConnectionError("Ollama dependencies not available.")
    
    final_user_prompt = _SYNTHESIS_PROMPT_TEMPLATE_STR.format(query=query, context=context_text)
    
    messages_for_api = []
    if system_prompt:
        messages_for_api.append(SystemMessage(content=system_prompt))
    
    if chat_history:
        for message in chat_history:
            role = message.get("role")
            text_part = message.get("parts", [{}])[0].get("text", "")
            if text_part:
                if role == "user":
                    messages_for_api.append(HumanMessage(content=text_part))
                else: # model
                    messages_for_api.append(AIMessage(content=text_part))
    
    messages_for_api.append(HumanMessage(content=final_user_prompt))
    
    model = ChatOllama(base_url=OLLAMA_BASE_URL, model=model_name or DEFAULT_OLLAMA_MODEL)
    logger.info(f"Calling Ollama for synthesis (Model: {model.model}) with {len(messages_for_api) -1} history messages.")
    
    try:
        response = model.invoke(messages_for_api)
        return _parse_thinking_and_answer(response.content)
    except Exception as e:
        logger.error(f"Ollama call failed during synthesis: {e}", exc_info=True)
        raise ConnectionError("Failed to get response from Ollama.") from e

def get_groq_llama3_response(query: str, context_text: str, model_name: str = None, user_grok_api_key: str = None, chat_history: list = None, system_prompt: str = None, **kwargs) -> tuple[str, str | None]:
    if not Groq: raise ConnectionError("Groq SDK not installed.")
    if not user_grok_api_key: raise ConnectionError("User Groq API key is required but was not provided.")
    local_groq_client = Groq(api_key=user_grok_api_key)
    
    final_user_prompt = _SYNTHESIS_PROMPT_TEMPLATE_STR.format(query=query, context=context_text)
    
    messages_for_api = []
    if system_prompt:
        messages_for_api.append({"role": "system", "content": system_prompt})
        
    if chat_history:
        for message in chat_history:
            role = message.get("role")
            text_part = message.get("parts", [{}])[0].get("text", "")
            if text_part:
                # Groq expects 'assistant' for model role
                api_role = "assistant" if role == "model" else "user"
                messages_for_api.append({"role": api_role, "content": text_part})
    
    messages_for_api.append({"role": "user", "content": final_user_prompt})
    
    model = model_name or DEFAULT_GROQ_LLAMA3_MODEL
    logger.info(f"Calling Groq for synthesis (Model: {model}) with {len(messages_for_api) -1} history messages.")

    try:
        completion = local_groq_client.chat.completions.create(
            messages=messages_for_api,
            model=model,
        )
        return _parse_thinking_and_answer(completion.choices[0].message.content)
    except Exception as e:
        logger.error(f"Groq API call failed during synthesis: {e}", exc_info=True)
        raise ConnectionError("Failed to get response from Groq.") from e

def generate_response(llm_provider: str, query: str, context_text: str, user_gemini_api_key: str = None, user_grok_api_key: str = None, chat_history: list = None, system_prompt: str = None, **kwargs) -> tuple[str, str | None]:
    """Main dispatcher to generate a synthesized response using per-request API keys."""
    logger.info(f"Generating synthesized response with provider: {llm_provider}.")
    
    provider_map = {
        "gemini": get_gemini_response,
        "ollama": get_ollama_response,
        "groq_llama3": get_groq_llama3_response,
    }
    
    # Use startswith for flexible provider matching (e.g., 'gemini-1.5-pro' matches 'gemini')
    matched_provider_key = next((key for key in provider_map if llm_provider.startswith(key)), None)

    if not matched_provider_key:
        logger.error(f"Unsupported LLM provider for synthesis: '{llm_provider}'")
        raise ValueError(f"Unsupported LLM provider: {llm_provider}")

    # Prepare arguments for the selected provider function
    # --- MODIFICATION START: Include history and system prompt in arguments ---
    call_args = { 
        "query": query, 
        "context_text": context_text,
        "chat_history": chat_history,
        "system_prompt": system_prompt, 
        **kwargs 
    }
    # --- MODIFICATION END ---

    if matched_provider_key == "gemini":
        call_args["user_gemini_api_key"] = user_gemini_api_key
    elif matched_provider_key == "groq_llama3":
        call_args["user_grok_api_key"] = user_grok_api_key
    
    # Call the selected provider's function with the appropriate arguments
    return provider_map[matched_provider_key](**call_args)