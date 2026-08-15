"""Chatbot Pydantic request models.

CRITICAL: none of these models expose a `user_id` field. The user is ALWAYS
derived server-side from get_current_user() and passed as a dict to the
memory + guard services. Accepting user_id from the body would be a direct
authorization bypass.
"""
from typing import Optional

from pydantic import BaseModel, Field


class ChatbotMessageInput(BaseModel):
    """POST /api/chatbot/message body.
    - `message` — the user's typed question.
    - `conversation_id` — optional; the caller can continue an existing
      conversation. If it doesn't belong to the caller (per chatbot_memory's
      scope filter), a NEW conversation is created transparently.
    """
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: Optional[str] = Field(default=None, max_length=64)


class RenameInput(BaseModel):
    """POST /api/chatbot/conversations/{id}/rename body."""
    title: str = Field(min_length=1, max_length=120)
