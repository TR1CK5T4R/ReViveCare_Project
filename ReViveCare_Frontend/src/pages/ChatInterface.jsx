import React, { useState, useRef, useEffect } from 'react';
import { Send, AlertCircle, Bot, User, Globe, ChevronDown, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, PageLayout } from '../components';
import djangoAPI from '../services/djangoApi';

// Language dropdown component
const LanguageSelector = ({ selectedLanguage, onLanguageChange }) => {
    const [isOpen, setIsOpen] = useState(false);

    const languages = [
        { code: 'english', label: 'English', flag: '🇬🇧' },
        { code: 'hindi', label: 'हिंदी (Hindi)', flag: '🇮🇳' }
    ];

    const selected = languages.find(l => l.code === selectedLanguage) || languages[0];

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
            >
                <Globe className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium">{selected.flag} {selected.label}</span>
                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[160px]">
                    {languages.map(lang => (
                        <button
                            key={lang.code}
                            onClick={() => {
                                onLanguageChange(lang.code);
                                setIsOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg flex items-center gap-2 ${selectedLanguage === lang.code ? 'bg-emerald-50 text-emerald-700' : ''
                                }`}
                        >
                            <span>{lang.flag}</span>
                            <span>{lang.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const InfoBanner = ({ message }) => (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3 mb-4">
        <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-900 leading-relaxed">{message}</p>
    </div>
);

const MessageBubble = ({ message, isAI }) => {
    return (
        <div className={`flex gap-3 mb-4 ${isAI ? 'justify-start' : 'justify-end'}`}>
            {isAI && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Bot className="w-5 h-5 text-white" />
                </div>
            )}

            <div className={`max-w-[70%] ${isAI ? 'order-2' : 'order-1'}`}>
                <div className={`rounded-2xl px-4 py-3 ${isAI
                    ? 'bg-white border border-gray-200 shadow-sm'
                    : 'bg-gradient-to-br from-emerald-600 to-emerald-700 text-white shadow-md'
                    }`}>
                    <p className={`text-sm leading-relaxed ${isAI ? 'text-gray-800' : 'text-white'}`}>
                        {message.text}
                    </p>
                </div>
                <span className={`text-xs text-gray-500 mt-1 block ${isAI ? 'text-left' : 'text-right'}`}>
                    {message.timestamp}
                </span>
            </div>

            {!isAI && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm order-2">
                    <User className="w-5 h-5 text-white" />
                </div>
            )}
        </div>
    );
};

const TypingIndicator = () => (
    <div className="flex gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
            <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
        </div>
    </div>
);

const QuickReplies = ({ suggestions, onSelect }) => (
    <div className="mb-4">
        <p className="text-xs text-gray-600 mb-2 font-medium">Quick questions:</p>
        <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion, index) => (
                <button
                    key={index}
                    onClick={() => onSelect(suggestion)}
                    className="px-3 py-2 bg-white border border-gray-300 rounded-full text-sm text-gray-700 hover:bg-emerald-50 hover:border-emerald-300 transition-all duration-200 hover:scale-105 active:scale-95"
                >
                    {suggestion}
                </button>
            ))}
        </div>
    </div>
);

// Main Chat Interface Component
function ChatInterface() {
    const navigate = useNavigate();
    const [language, setLanguage] = useState('english');
    const [messages, setMessages] = useState([
        {
            id: 1,
            text: "Hello! I'm your ReviveCare medical assistant. I'm here to help with your post-surgery recovery. How are you feeling today?",
            isAI: true,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    const quickSuggestions = language === 'hindi'
        ? ["क्या मैं आज व्यायाम कर सकता हूं?", "मेरी दवाइयों के बारे में बताएं", "मुझे दर्द हो रहा है", "घाव की देखभाल"]
        : ["Can I exercise today?", "What about my medications?", "I'm experiencing pain", "Wound care instructions"];

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    // Update welcome message when language changes
    useEffect(() => {
        const welcomeMessage = language === 'hindi'
            ? "नमस्ते! मैं आपका ReviveCare मेडिकल सहायक हूं। मैं आपके सर्जरी के बाद की रिकवरी में मदद करने के लिए यहां हूं। आप आज कैसा महसूस कर रहे हैं?"
            : "Hello! I'm your ReviveCare medical assistant. I'm here to help with your post-surgery recovery. How are you feeling today?";

        if (messages.length === 1 && messages[0].id === 1) {
            setMessages([{
                id: 1,
                text: welcomeMessage,
                isAI: true,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }]);
        }
    }, [language]);

    const handleSend = async () => {
        if (inputValue.trim() === '') return;

        const newMessage = {
            id: messages.length + 1,
            text: inputValue,
            isAI: false,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages([...messages, newMessage]);
        setInputValue('');

        // Send to Django chatbot API with language
        setIsTyping(true);
        try {
            const response = await djangoAPI.chatbot.sendMessage(inputValue, language);

            if (response.success) {
                const aiResponse = {
                    id: messages.length + 2,
                    text: response.response,
                    isAI: true,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    seriousnessScore: response.seriousness_score
                };
                setMessages(prev => [...prev, aiResponse]);
            } else {
                // Fallback error message
                const errorMsg = language === 'hindi'
                    ? "कनेक्ट करने में समस्या हो रही है। कृपया पुनः प्रयास करें।"
                    : "I'm having trouble connecting right now. Please try again or contact your doctor if this is urgent.";
                const errorResponse = {
                    id: messages.length + 2,
                    text: errorMsg,
                    isAI: true,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                };
                setMessages(prev => [...prev, errorResponse]);
            }
        } catch (error) {
            console.error('Chatbot error:', error);
            const errorMsg = language === 'hindi'
                ? "कनेक्ट करने में समस्या हो रही है। कृपया पुनः प्रयास करें।"
                : "I'm having trouble connecting right now. Please try again or contact your doctor if this is urgent.";
            const errorResponse = {
                id: messages.length + 2,
                text: errorMsg,
                isAI: true,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            setMessages(prev => [...prev, errorResponse]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleQuickReply = (suggestion) => {
        setInputValue(suggestion);
        inputRef.current?.focus();
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <PageLayout>
            <div className="max-w-4xl mx-auto">
                {/* Header with language selector */}
                <div className="mb-6 flex items-start justify-between">
                    <div>
                        <button
                            onClick={() => navigate('/patient/dashboard')}
                            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors mb-2"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            <span className="font-medium">Back to Dashboard</span>
                        </button>
                        <h1 className="text-3xl font-bold text-slate-900">Medical Assistant</h1>
                        <p className="text-slate-600">Chat with your AI recovery assistant</p>
                    </div>
                    <LanguageSelector
                        selectedLanguage={language}
                        onLanguageChange={setLanguage}
                    />
                </div>

                <InfoBanner
                    message={language === 'hindi'
                        ? "यदि लक्षण गंभीर दिखाई देते हैं, तो आपके डॉक्टर को स्वचालित रूप से सूचित किया जाएगा"
                        : "If symptoms appear serious, your doctor will be notified automatically"
                    }
                />

                <Card className="overflow-hidden flex flex-col p-0" style={{ height: 'calc(100vh - 380px)' }}>
                    {/* Messages area */}
                    <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                        {messages.map((message) => (
                            <MessageBubble key={message.id} message={message} isAI={message.isAI} />
                        ))}
                        {isTyping && <TypingIndicator />}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Quick replies */}
                    <div className="px-6 pt-4 bg-white border-t border-gray-100">
                        <QuickReplies suggestions={quickSuggestions} onSelect={handleQuickReply} />
                    </div>

                    {/* Input area */}
                    <div className="p-6 pt-2 bg-white">
                        <div className="flex gap-3">
                            <input
                                ref={inputRef}
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder={language === 'hindi' ? "अपना संदेश लिखें..." : "Type your message..."}
                                className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                            />
                            <button
                                onClick={handleSend}
                                disabled={!inputValue.trim() || isTyping}
                                className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
                            >
                                <Send className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </Card>
            </div>
        </PageLayout>
    );
}

export default ChatInterface;