import React, { useState, useEffect } from 'react';
import { services } from '../../../application/services/serviceContainer.js';
import { useToasts } from '../../hooks/useToasts.js';
import { Identicon } from '../common/Identicon.jsx';

export function GroupInfoModal({ chatId, isOpen, onClose, t = (k, f) => f }) {
  const { showToast } = useToasts();
  const [members, setMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState('member');
  
  const currentUserData = JSON.parse(localStorage.getItem('craneapp_user_data') || '{}');

  useEffect(() => {
    if (isOpen) {
      fetchMembers();
    }
  }, [isOpen, chatId]);

  async function fetchMembers() {
    setIsLoading(true);
    try {
      const nextMembers = await services.chatService.getMembers(chatId);
      setMembers(nextMembers);
      const myMember = nextMembers.find(m => m.id === currentUserData.id);
      if (myMember) {
        setCurrentUserRole(myMember.role || 'member');
      }
    } catch (err) {
      showToast('error', 'Ошибка загрузки участников', '❌');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAction(endpoint, method, userId, body = null) {
    try {
      if (endpoint === '/role' && method === 'POST') {
        await services.chatService.setMemberRole(chatId, userId, body?.role);
      } else if (endpoint === '' && method === 'DELETE') {
        await services.chatService.removeMember(chatId, userId);
      } else {
        throw new Error('Unsupported group action');
      }
      showToast('success', 'Действие выполнено', '✅');
      fetchMembers();
    } catch (err) {
      showToast('error', err.message || 'Ошибка выполнения действия', '❌');
    }
  }

  if (!isOpen) return null;

  return (
    <div className="group-info-modal-overlay" onClick={onClose}>
      <div className="group-info-modal-content glass-panel" onClick={e => e.stopPropagation()}>
        <header className="group-info-header">
          <h2>Участники группы</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </header>

        <div className="group-info-body">
          {isLoading ? (
            <div className="loading-state">Загрузка...</div>
          ) : (
            <ul className="members-list">
              {members.map(member => {
                const memberId = member.id;
                const avatarUrl = member.avatarUrl;
                return (
                <li key={memberId} className="member-item">
                  <div className="member-avatar">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="avatar" />
                    ) : (
                      <Identicon userId={memberId} size={44} />
                    )}
                  </div>
                  <div className="member-details">
                    <span className="member-name">{member.username}</span>
                    <span className={`member-role role-${member.role}`}>{member.role}</span>
                  </div>
                  
                  {/* Moderation Controls */}
                  {(currentUserRole === 'owner' || currentUserRole === 'admin') && memberId !== currentUserData.id && (
                    <div className="member-actions">
                      {currentUserRole === 'owner' && (
                        <button 
                          className="action-btn"
                          onClick={() => handleAction('/role', 'POST', memberId, { 
                            role: member.role === 'admin' ? 'member' : 'admin' 
                          })}
                        >
                          {member.role === 'admin' ? 'Снять админа' : 'Дать админа'}
                        </button>
                      )}
                      <button 
                        className="action-btn danger"
                        onClick={() => handleAction('', 'DELETE', memberId)}
                      >
                        Кикнуть
                      </button>
                    </div>
                  )}
                </li>
              )})}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
