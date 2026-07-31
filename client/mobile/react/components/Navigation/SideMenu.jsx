import React from 'react';
import '../../styles/SideMenu.css';
export function SideMenu({ isOpen, onClose, onOpenSettings }) {
  if (!isOpen) return null;

  return (
    <div className="sidebar-backdrop" onClick={onClose}>
      <div className="sidebar-drawer liquid-glass-menu-block" onClick={(e) => e.stopPropagation()}>

        <div className="sidebar-header">
      <div className="sidebar-title-group">
        <h2 className="sidebar-title">Настройки</h2>
      </div>
    </div>

        <div className="sidebar-menu-list">
          <div className="settings-row-item" onClick={() => { onOpenSettings(); onClose(); }}>
            <div className="settings-row-left">
              <span className="sidebar-icon sidebar-icon-account"></span>
              <span>Аккаунт</span>
            </div>
          </div>

          <div className="settings-row-item placeholder-row">
            <div className="settings-row-left">
              <span className="sidebar-icon sidebar-icon-notifications"></span>
              <span>Уведомления</span>
            </div>
          </div>

          <div className="settings-row-item placeholder-row">
            <div className="settings-row-left">
              <span className="sidebar-icon sidebar-icon-appearance"></span>
              <span>Внешний вид</span>
            </div>
          </div>

          <div className="settings-row-item placeholder-row">
            <div className="settings-row-left">
              <span className="sidebar-icon sidebar-icon-privacy"></span>
              <span>Конфиденциальность</span>
            </div>
          </div>

          <div className="settings-row-item placeholder-row">
            <div className="settings-row-left">
              <span className="sidebar-icon sidebar-icon-languages"></span>
              <span>Языки</span>
            </div>
          </div>

          <div className="settings-row-item placeholder-row">
            <div className="settings-row-left">
              <span className="sidebar-icon sidebar-icon-about"></span>
              <span>О приложении</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}