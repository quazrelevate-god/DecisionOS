"""Signup / interview request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import List, Optional
from pydantic import BaseModel, Field


class EmailCheckInput(BaseModel):
    email: str = Field(max_length=200)


class WebsiteIntelInput(BaseModel):
    url: str = Field(max_length=500)
    company_name: Optional[str] = Field(default="", max_length=200)


class InterviewStartInput(BaseModel):
    company_name: str = Field(max_length=200)
    founder_name: Optional[str] = Field(default="", max_length=120)
    team_size: Optional[str] = Field(default="", max_length=40)
    industry: Optional[str] = Field(default="", max_length=120)
    business_model: Optional[str] = Field(default="", max_length=40)
    description: Optional[str] = Field(default="", max_length=2000)
    website_summary: Optional[str] = Field(default="", max_length=2000)
    products: Optional[List[dict]] = None
    language_code: Optional[str] = Field(default="en-IN", max_length=16)


class InterviewAnswerInput(BaseModel):
    session_id: str = Field(max_length=64)
    answer: str = Field(max_length=4000)
    language_code: Optional[str] = Field(default="", max_length=16)


class InterviewSessionInput(BaseModel):
    session_id: str = Field(max_length=64)
    language_code: Optional[str] = Field(default="", max_length=16)


class InterviewRefineInput(BaseModel):
    session_id: str = Field(max_length=64)
    refinement: str = Field(max_length=4000)
    language_code: Optional[str] = Field(default="", max_length=16)


class TTSInput(BaseModel):
    text: str = Field(max_length=1200)
    language_code: Optional[str] = Field(default="en-IN", max_length=16)
